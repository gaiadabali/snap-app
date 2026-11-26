// The engine has no react-dom dependency of its own besides this test; a two-line
// declaration avoids adding @types/react-dom (and a lockfile change) for one function.
declare module "react-dom/server" {
  export function renderToString(element: import("react").ReactElement): string;
}
