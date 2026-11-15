// Type for Vite's "?worker" imports (a constructor for a dedicated Web Worker).
declare module "*?worker" {
  const WorkerConstructor: { new (options?: { name?: string }): Worker };
  export default WorkerConstructor;
}
