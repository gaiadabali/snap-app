/**
 * The one function the component render tests use from react-dom. The mobile
 * app does not depend on @types/react-dom (it renders with react-native, not
 * react-dom), and a test-only declaration is lighter than a new dependency.
 */
declare module 'react-dom/server' {
  export function renderToStaticMarkup(element: unknown): string;
}
