import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AuthReturnPage } from './AuthReturnPage';

const html = (outcome: 'handed-back' | 'nothing-waiting') =>
  renderToStaticMarkup(createElement(AuthReturnPage, { outcome, onOpenApp: () => {} }));

describe('AuthReturnPage', () => {
  it('while handing back: says it is signing in, with no button', () => {
    const t = html('handed-back');
    expect(t).toContain('Signing you in…');
    expect(t).not.toContain('Open SnapApps');
  });

  it('with nothing waiting: says so and offers to open the app', () => {
    const t = html('nothing-waiting');
    expect(t).toContain('This sign-in has finished');
    expect(t).toContain('Open SnapApps');
  });
});
