// heic-decode ships no types. Only the call heicToJpeg makes is declared.
declare module 'heic-decode' {
  export interface DecodedImage {
    width: number;
    height: number;
    /** RGBA, 4 bytes per pixel. */
    data: Uint8ClampedArray;
  }
  export default function decode(input: { buffer: ArrayBuffer | Uint8Array }): Promise<DecodedImage>;
}
