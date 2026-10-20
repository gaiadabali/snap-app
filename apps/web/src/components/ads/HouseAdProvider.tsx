'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { HouseAdContext } from '@/lib/house-ads';

const Ctx = createContext<HouseAdContext>({});

/**
 * Supplies what a whole panel already knows to every `<HouseAd>` under it, so
 * five pages do not each fetch it. The individual panel's layout uses it to
 * say whether the YourTal link is on (`yourtalAvailable`): the YourTal ad
 * sends people to a page that does not exist when it is off.
 */
export function HouseAdProvider({ context, children }: { context: HouseAdContext; children: ReactNode }) {
  return <Ctx.Provider value={context}>{children}</Ctx.Provider>;
}

/** The panel-wide context. A slot's own `context` prop wins over it. */
export function usePanelAdContext(): HouseAdContext {
  return useContext(Ctx);
}
