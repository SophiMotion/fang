declare module 'occt-import-js' {
  interface OcctMesh { name?: string; color?: number[]; attributes: { position: { array: number[] } }; index: { array: number[] } }
  interface OcctNode { name?: string; meshes?: number[]; children?: OcctNode[] }
  interface OcctResult { success: boolean; meshes?: OcctMesh[]; root?: OcctNode }
  interface OcctApi { ReadStepFile(data: Uint8Array, options: object): OcctResult; ReadIgesFile(data: Uint8Array, options: object): OcctResult }
  export default function initialize(options?: { locateFile?: (path: string) => string; print?: (message: string) => void; printErr?: (message: string) => void; wasmBinary?: Uint8Array }): Promise<OcctApi>
}
