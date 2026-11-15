#!/usr/bin/env python3
"""KIF-031/032/050 acceptance against the prebuilt local app, using synthetic data.

Run after `npm run build`: python tests/browser/backup_learning.py
Fixture-only validation (no server/browser): add --fixtures-only.
Requires the CI-pinned Playwright 1.62.0 and its Chromium headless shell.
375px Chromium is a small-screen check, not an iPhone/Safari measurement.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
from importlib.metadata import version
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import traceback
from typing import Any, Iterator
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import urlopen

from playwright.sync_api import Browser, Page, Route, expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / ".sites-runtime" / "browser-artifacts"
BASE_URL = "http://127.0.0.1:4186"
STORAGE_KEY = "kifu-rival.v1"
RECOVERY_KEY = "kifu-rival.before-restore.v1"
PLAYWRIGHT_VERSION = "1.62.0"
JSON_DATA = dict[str, Any]


class SuiteDeadline(Exception):
    """Stop the whole suite instead of continuing after its time budget."""


def raw(page: Page, key: str = STORAGE_KEY) -> str | None:
    return page.evaluate("key => localStorage.getItem(key)", key)


def state(page: Page) -> JSON_DATA:
    value = raw(page)
    assert value is not None
    return json.loads(value)


def wait_state(page: Page, condition: str, value: Any = None) -> None:
    page.wait_for_function(
        """({key, value}) => {
          try {
            const saved = JSON.parse(localStorage.getItem(key));
            return (""" + condition + """);
          } catch { return false; }
        }""",
        arg={"key": STORAGE_KEY, "value": value},
    )


def wait_full_state(page: Page, expected: JSON_DATA) -> None:
    # Compare all fields without depending on JSON object key ordering.
    page.wait_for_function(
        """({key, expected}) => {
          const ordered = value => Array.isArray(value) ? value.map(ordered)
            : value && typeof value === 'object'
              ? Object.fromEntries(Object.keys(value).sort().map(k => [k, ordered(value[k])]))
              : value;
          try { return JSON.stringify(ordered(JSON.parse(localStorage.getItem(key))))
            === JSON.stringify(ordered(expected)); } catch { return false; }
        }""",
        arg={"key": STORAGE_KEY, "expected": expected},
    )


def wait_boot(page: Page) -> None:
    expect(page.locator(".content-wrap")).to_have_attribute("aria-busy", "false", timeout=30_000)


def navigate(page: Page, name: str) -> None:
    page.get_by_role("navigation", name="モバイルメニュー").get_by_role("button", name=name, exact=True).click()


def backup_panel(page: Page):
    return page.get_by_role("region", name="記録の持ち出しと復元", exact=True)


def screenshot(page: Page, name: str) -> None:
    page.screenshot(path=str(ARTIFACTS / f"{name}.png"), full_page=True, animations="disabled")


def download(page: Page, button_name: str, filename: str) -> Path:
    with page.expect_download(timeout=30_000) as pending:
        backup_panel(page).get_by_role("button", name=button_name, exact=True).click()
    downloaded = pending.value
    assert downloaded.suggested_filename.endswith(".json")
    destination = ARTIFACTS / filename
    downloaded.save_as(destination)
    assert downloaded.failure() is None
    assert destination.is_file(), "The browser download must produce a real file"
    return destination


def backup_data(path: Path) -> JSON_DATA:
    envelope = json.loads(path.read_text(encoding="utf-8"))
    assert set(envelope) == {"format", "version", "exportedAt", "data"}
    assert envelope["format"] == "kiyu-backup" and envelope["version"] == 1
    datetime.fromisoformat(envelope["exportedAt"].replace("Z", "+00:00"))
    assert set(envelope["data"]) == {
        "game", "level", "declarationRule", "completed", "lessonAttempts", "records",
        "messages", "cloudSyncPaused", "seenLessons", "pendingHints",
    }
    return envelope["data"]


def upload_json(page: Page, name: str, value: JSON_DATA) -> None:
    page.get_by_label("復元する記録ファイル", exact=True).set_input_files({
        "name": name, "mimeType": "application/json",
        "buffer": json.dumps(value, ensure_ascii=False).encode("utf-8"),
    })


def preview(page: Page):
    result = page.get_by_role("region", name="復元内容の確認", exact=True)
    expect(result).to_be_visible(timeout=30_000)
    return result


@contextmanager
def mobile_page(browser: Browser, initial_raw: str, case_name: str) -> Iterator[tuple[Page, list[str]]]:
    # This origin is fixed to the local test server. Never use a signed-in profile.
    context = browser.new_context(
        viewport={"width": 375, "height": 812}, device_scale_factor=1,
        is_mobile=True, has_touch=True, locale="ja-JP", timezone_id="Asia/Tokyo",
        color_scheme="light", reduced_motion="reduce", accept_downloads=True,
        service_workers="block",
        storage_state={"cookies": [], "origins": [{"origin": BASE_URL, "localStorage": [
            {"name": STORAGE_KEY, "value": initial_raw},
        ]}]},
    )
    progress_requests: list[str] = []
    errors: list[str] = []

    def route(request: Route) -> None:
        url = urlsplit(request.request.url)
        if url.scheme in ("http", "https") and f"{url.scheme}://{url.netloc}" != BASE_URL:
            request.abort()
        elif url.path.startswith("/api/"):
            # No cloud/API request reaches a backend; all fixtures remain local.
            progress_requests.append(f"{request.request.method} {url.path}")
            request.fulfill(status=200, content_type="application/json", body=json.dumps({"completed": [], "games": [], "ok": True}))
        else:
            request.continue_()

    context.route("**/*", route)
    page = context.new_page()
    page.set_default_timeout(10_000)
    page.set_default_navigation_timeout(30_000)
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        page.goto(BASE_URL, wait_until="domcontentloaded")
        wait_boot(page)
        yield page, progress_requests
        assert not errors, f"Uncaught browser error(s): {errors}"
    except BaseException:
        try:
            screenshot(page, f"{case_name}-FAILED")
            (ARTIFACTS / f"{case_name}-browser-errors.json").write_text(json.dumps(errors, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass
        raise
    finally:
        context.close()


def export_restore_reload(browser: Browser, fixtures: JSON_DATA) -> None:
    with mobile_page(browser, json.dumps(fixtures["full"]), "01-roundtrip") as (page, requests):
        wait_full_state(page, fixtures["full"])
        navigate(page, "成長の記録")
        expect(page.locator(".save-status")).to_contain_text("クラウド：対局・達成・会話の一部を同期")
        original_file = download(page, "記録を書き出す", "01-original-backup.json")
        assert backup_data(original_file) == fixtures["full"]

        # Change real UI state (game/result/record, settings and chat), then restore it.
        navigate(page, "対局する")
        page.get_by_label("対局レベル", exact=True).select_option("1")
        page.locator("#declaration-rule").select_option("amateur27")
        page.get_by_role("button", name="投了する", exact=True).click()
        page.get_by_label("棋友へのメッセージ", exact=True).fill("ブラウザ受入用の一時メッセージ")
        page.get_by_role("button", name="送信", exact=True).click()
        wait_state(page, "saved.level === 1 && saved.game.result === 'white' && saved.records.length === value.records.length + 1 && saved.messages.length === value.messages.length + 2", fixtures["full"])
        changed = state(page)
        before_raw = raw(page)
        assert changed != fixtures["full"]
        navigate(page, "成長の記録")
        page.get_by_label("復元する記録ファイル", exact=True).set_input_files(original_file)
        confirmation = preview(page)
        expect(confirmation.get_by_role("button", name="この内容で復元する", exact=True)).to_be_disabled()
        assert raw(page) == before_raw, "Preview must not change stored bytes"
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "375px preview must not overflow horizontally"
        screenshot(page, "01-mobile-preview")

        prior_file = download(page, "復元前の記録を書き出す", "01-before-restore.json")
        assert backup_data(prior_file) == changed
        expect(confirmation.get_by_role("button", name="この内容で復元する", exact=True)).to_be_enabled()
        confirmation.get_by_role("button", name="この内容で復元する", exact=True).click()
        expected = {**fixtures["full"], "cloudSyncPaused": True}
        wait_full_state(page, expected)
        assert raw(page, RECOVERY_KEY) == before_raw, "One-generation recovery must keep exact prior bytes"
        expect(page.locator(".save-status")).to_contain_text("クラウド：復元後の同期を停止中")
        request_count = len(requests)
        page.reload(wait_until="domcontentloaded")
        wait_boot(page)
        wait_full_state(page, expected)
        navigate(page, "成長の記録")
        expect(page.locator(".save-status")).to_contain_text("クラウド：復元後の同期を停止中")
        expect(page.get_by_role("button", name="同期を再開", exact=True)).to_be_visible()
        assert backup_data(download(page, "記録を書き出す", "01-after-reload.json")) == expected
        assert len(requests) == request_count, "Reload must not silently resume cloud synchronization"
        backup_panel(page).get_by_text("保存記録をそのまま退避する", exact=True).click()
        recovery_file = download(page, "直前の復元前データを書き出す", "01-recovery-raw.json")
        assert recovery_file.read_text(encoding="utf-8") == before_raw
        screenshot(page, "01-mobile-restored")


def invalid_and_quota(browser: Browser, fixtures: JSON_DATA) -> None:
    with mobile_page(browser, json.dumps(fixtures["full"]), "02-quota") as (page, _requests):
        wait_full_state(page, fixtures["full"])
        navigate(page, "成長の記録")
        expect(page.locator(".save-status")).to_contain_text("クラウド：対局・達成・会話の一部を同期")
        original_raw = raw(page)
        future = {**fixtures["emptyBackup"], "version": 999}
        upload_json(page, "synthetic-future.json", future)
        expect(backup_panel(page).get_by_role("alert")).to_contain_text("この版では読めないバックアップ")
        expect(page.get_by_role("region", name="復元内容の確認", exact=True)).to_have_count(0)
        assert raw(page) == original_raw
        page.get_by_label("復元する記録ファイル", exact=True).set_input_files({
            "name": "synthetic-invalid.json", "mimeType": "application/json", "buffer": b'{"broken":',
        })
        expect(backup_panel(page).get_by_role("alert")).to_contain_text("JSONを読み込めません")
        expect(page.get_by_role("region", name="復元内容の確認", exact=True)).to_have_count(0)
        assert raw(page) == original_raw

        upload_json(page, "synthetic-replacement.json", fixtures["emptyBackup"])
        confirmation = preview(page)
        download(page, "復元前の記録を書き出す", "02-before-failed-restore.json")
        # Inject only synthetic quota failures; restore must survive either write failing.
        page.evaluate("""() => {
          const original = Storage.prototype.setItem;
          window.__kiyuFailStorageKey = null;
          Storage.prototype.setItem = function(key, value) {
            if (this === window.localStorage && key === window.__kiyuFailStorageKey)
              throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
            return original.call(this, key, value);
          };
        }""")
        for failing_key in (RECOVERY_KEY, STORAGE_KEY):
            page.evaluate("key => { window.__kiyuFailStorageKey = key; }", failing_key)
            confirmation.get_by_role("button", name="この内容で復元する", exact=True).click()
            expect(backup_panel(page).get_by_role("alert")).to_contain_text("元の保存記録は変更していません")
            assert raw(page) == original_raw
        assert raw(page, RECOVERY_KEY) == original_raw
        confirmation.get_by_role("button", name="やめる", exact=True).click()

        # A normal UI mutation survives in memory when the disk write fails.
        navigate(page, "対局する")
        page.get_by_role("button", name="投了する", exact=True).click()
        expect(page.locator(".storage-warning")).to_contain_text("端末への保存に失敗しました")
        assert raw(page) == original_raw
        navigate(page, "成長の記録")
        expect(page.locator(".record-list .record-line")).to_have_count(len(fixtures["full"]["records"]) + 1)
        memory = backup_data(download(page, "記録を書き出す", "02-memory-after-quota.json"))
        assert memory["game"]["result"] == "white"
        assert memory["records"][0]["result"] == "white"
        assert memory["records"][1:] == fixtures["full"]["records"]
        assert memory["lessonAttempts"] == fixtures["full"]["lessonAttempts"]
        assert memory["messages"] == fixtures["full"]["messages"]
        assert raw(page) == original_raw, "Exporting memory must not overwrite the retained old bytes"
        screenshot(page, "02-mobile-storage-failure")


def damaged_boot(browser: Browser, _fixtures: JSON_DATA) -> None:
    for label, damaged in (("empty", ""), ("broken", '{"not-json":')):
        with mobile_page(browser, damaged, f"03-boot-{label}") as (page, requests):
            expect(page.locator(".storage-warning")).to_contain_text("自動保存を停止しています")
            assert raw(page) == damaged
            page.get_by_label("対局レベル", exact=True).select_option("4")
            navigate(page, "成長の記録")
            memory = backup_data(download(page, "記録を書き出す", f"03-{label}-memory.json"))
            assert memory["level"] == 4
            assert raw(page) == damaged
            backup_panel(page).get_by_text("保存記録をそのまま退避する", exact=True).click()
            rescue = download(page, "端末の保存内容を書き出す", f"03-{label}-original-raw.json")
            assert rescue.read_text(encoding="utf-8") == damaged
            assert not requests, "Damaged boot data must not be merged with cloud data"
            screenshot(page, f"03-mobile-{label}-boot")
            page.reload(wait_until="domcontentloaded")
            wait_boot(page)
            expect(page.locator(".storage-warning")).to_contain_text("自動保存を停止しています")
            assert raw(page) == damaged


def select_gold_lesson(page: Page, fixtures: JSON_DATA) -> None:
    navigate(page, "教材モード")
    page.locator(".lesson-list .lesson-item").filter(has_text=fixtures["goldLesson"]["title"]).click()
    expect(page.locator(".lesson-stage h2")).to_have_text(fixtures["goldLesson"]["title"])


def answer_gold(page: Page, square: str) -> None:
    stage = page.locator(".lesson-stage")
    stage.locator(".hand-area:not(.hand-opponent)").get_by_role("button", name="金 2枚", exact=True).click()
    stage.get_by_role("gridcell", name=f"{square} 空きマス", exact=True).click()
    expect(stage.locator(".practice-feedback")).to_contain_text("正解です。詰みへつながる初手を選べました")


def alternate_hint_repeat(browser: Browser, fixtures: JSON_DATA) -> None:
    with mobile_page(browser, json.dumps(fixtures["empty"]), "04-learning") as (page, _requests):
        lesson_id = fixtures["goldLesson"]["id"]
        select_gold_lesson(page, fixtures)
        page.locator(".lesson-stage").get_by_role("button", name="ヒントを見る", exact=True).click()
        wait_state(page, "saved.pendingHints.includes(value)", lesson_id)
        page.reload(wait_until="domcontentloaded")
        wait_boot(page)
        assert lesson_id in state(page)["pendingHints"]
        select_gold_lesson(page, fixtures)
        answer_gold(page, "3二")  # G*3b is the correct alternative, not lesson.answer.
        solution = page.locator(".lesson-solution")
        expect(solution).to_contain_text("▲3二金打→△5一玉→▲5二金打も正解")
        expect(solution).to_contain_text("今回は初手の選択を記録しました")
        # The app records the first move, without pretending the whole line was played.
        expect(page.locator(".lesson-stage").get_by_role("gridcell", name="4一 後手玉", exact=True)).to_be_visible()
        expect(page.locator(".lesson-stage").get_by_role("gridcell", name="5二 空きマス", exact=True)).to_be_visible()
        wait_state(page, "saved.lessonAttempts.length === 1 && saved.seenLessons.includes(value) && !saved.pendingHints.includes(value)", lesson_id)
        first = state(page)["lessonAttempts"][0]
        assert {key: first[key] for key in ("lessonId", "correct", "hinted", "firstSeen")} == {
            "lessonId": lesson_id, "correct": True, "hinted": True, "firstSeen": True,
        }
        screenshot(page, "04-mobile-correct-alternative")
        page.locator(".lesson-stage").get_by_role("button", name="やり直す", exact=True).click()
        answer_gold(page, "5二")
        wait_state(page, "saved.lessonAttempts.length === 2")
        second = state(page)["lessonAttempts"][1]
        assert second["correct"] is True and second["hinted"] is False and second["firstSeen"] is False
        attempts = state(page)["lessonAttempts"]
        page.reload(wait_until="domcontentloaded")
        wait_boot(page)
        assert state(page)["lessonAttempts"] == attempts


def replace_displayed_review(browser: Browser, fixtures: JSON_DATA) -> None:
    with mobile_page(browser, json.dumps(fixtures["reviewOld"]), "05-review") as (page, _requests):
        navigate(page, "成長の記録")
        review = page.locator(".game-review")
        expect(review.locator(".game-review-list li")).to_have_count(1, timeout=30_000)
        expect(review).to_contain_text("指した手では")
        expect(review.locator(".review-chance")).to_have_count(0)
        expect(review.get_by_role("button", name="今日の課題へ", exact=True)).to_be_visible()
        screenshot(page, "05-mobile-old-review-displayed")
        # Restore in the same mounted app after the OLD result is already visible.
        # Both records have the same ID, date, start SFEN and number of moves.
        upload_json(page, "synthetic-same-id-new-moves.json", fixtures["reviewNewBackup"])
        confirmation = preview(page)
        download(page, "復元前の記録を書き出す", "05-before-review-replacement.json")
        confirmation.get_by_role("button", name="この内容で復元する", exact=True).click()
        wait_full_state(page, fixtures["reviewNew"])
        expect(review.locator(".review-chance")).to_have_text("より短い詰み", timeout=30_000)
        expect(review).to_contain_text("指した手でも詰みでした")
        expect(review.get_by_text("指した手では", exact=False)).to_have_count(0)
        expect(review.locator(".game-review-list li")).to_have_count(1)
        expect(review.get_by_role("button", name="今日の課題へ", exact=True)).to_have_count(0)
        screenshot(page, "05-mobile-new-review-only")


def generate_fixtures() -> JSON_DATA:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    bundled = ARTIFACTS / "fixtures.mjs"
    subprocess.run([
        str(ROOT / "node_modules" / ".bin" / "esbuild"), "tests/browser/fixtures.ts",
        "--bundle", "--platform=node", "--format=esm", f"--outfile={bundled}",
    ], cwd=ROOT, check=True, timeout=30)
    fixture_path = ARTIFACTS / "fixtures.json"
    with fixture_path.open("w", encoding="utf-8") as destination:
        subprocess.run(["node", str(bundled)], cwd=ROOT, check=True, stdout=destination, timeout=30)
    return json.loads(fixture_path.read_text(encoding="utf-8"))


@contextmanager
def local_server() -> Iterator[None]:
    assert (ROOT / "dist" / "server" / "wrangler.json").is_file(), "Run npm run build first"
    # Refuse an occupied port instead of accidentally testing another running app.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 4186))
    with (ARTIFACTS / "server.log").open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            ["npm", "start", "--", "--port", "4186"], cwd=ROOT,
            env={**os.environ, "CI": "true", "WRANGLER_SEND_METRICS": "false"},
            stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
        )
        try:
            deadline = time.monotonic() + 60
            while True:
                if process.poll() is not None:
                    raise RuntimeError("Local app server exited; inspect server.log")
                try:
                    with urlopen(BASE_URL, timeout=2) as response:
                        if response.status == 200:
                            break
                except (OSError, URLError):
                    pass
                if time.monotonic() >= deadline:
                    raise TimeoutError("Local app server was not ready within 60 seconds")
                time.sleep(0.25)
            yield
        finally:
            try:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
            except ProcessLookupError:
                pass


def main() -> int:
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("--fixtures-only", action="store_true")
    args = arguments.parse_args()
    assert version("playwright") == PLAYWRIGHT_VERSION, "Use the Playwright version pinned in verify.yml"
    fixtures = generate_fixtures()
    if args.fixtures_only:
        print("Synthetic fixtures validated; no browser tests were run.", flush=True)
        return 0

    started = time.monotonic()
    report: JSON_DATA = {
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "playwright": version("playwright"), "viewport": {"width": 375, "height": 812},
        "scope": "Synthetic localhost data; Chromium only. iPhone/Safari is not measured.", "cases": [],
    }

    def deadline(_signum, _frame):
        raise SuiteDeadline("Browser acceptance exceeded its 330-second budget")

    signal.signal(signal.SIGALRM, deadline)
    signal.alarm(330)
    try:
        with local_server(), sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, timeout=30_000)
            try:
                report["browser"] = browser.version
                for test in (export_restore_reload, invalid_and_quota, damaged_boot, alternate_hint_repeat, replace_displayed_review):
                    case_start = time.monotonic()
                    case: JSON_DATA = {"name": test.__name__}
                    try:
                        test(browser, fixtures)
                        case["status"] = "passed"
                    except SuiteDeadline:
                        raise
                    except Exception:
                        case["status"] = "failed"
                        case["error"] = traceback.format_exc()
                        print(case["error"], file=sys.stderr, flush=True)
                    case["seconds"] = round(time.monotonic() - case_start, 2)
                    report["cases"].append(case)
                    print(f"{case['status'].upper()}: {case['name']} ({case['seconds']}s)", flush=True)
            finally:
                browser.close()
    except Exception:
        report["fatal"] = traceback.format_exc()
        print(report["fatal"], file=sys.stderr, flush=True)
    finally:
        signal.alarm(0)
        report["seconds"] = round(time.monotonic() - started, 2)
        report["passed"] = not report.get("fatal") and len(report["cases"]) == 5 and all(case["status"] == "passed" for case in report["cases"])
        (ARTIFACTS / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
