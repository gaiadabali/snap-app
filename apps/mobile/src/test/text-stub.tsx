/**
 * Stands in for `@/theme/text` under test. The real module loads Geist from
 * font files, which Node cannot import and which a render test does not need.
 */
export { Text, TextInput } from 'react-native';
export const face = () => undefined;
