/** Stands in for react-native-svg under test: its native entry points pull in Flow-typed react-native internals Node cannot parse. Icons render as empty boxes. */
import { createElement, type ReactNode } from 'react';

const Svg = ({ children }: { children?: ReactNode }) => createElement('svg', null, children);
export const Path = () => null;
export const Rect = () => null;
export const Circle = () => null;
export type SvgProps = Record<string, unknown>;
export default Svg;
