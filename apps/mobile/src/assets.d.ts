/** Metro resolves an imported image to an asset id, which `Image source` takes. */
declare module '*.png' {
  const asset: number;
  export default asset;
}
