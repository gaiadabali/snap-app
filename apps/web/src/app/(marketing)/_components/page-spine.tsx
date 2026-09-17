/**
 * The reading rail — a curve in the left margin that draws itself as you
 * scroll, with a node riding its leading edge.
 *
 * Two earlier versions and what each got wrong, because both are easy to
 * repeat:
 *
 * 1. A straight 1px hairline at full page height. It read as a second edge
 *    competing with the text column, and because it never changed it gave the
 *    eye nothing to do except notice it.
 * 2. A curve — better, but placed in a band that OVERLAPPED the reading
 *    column. At 1440px the rail occupied x 80–160 while the h1 began at 120,
 *    so the curve crossed the display type. Measured, not guessed: the numbers
 *    came back from `getBoundingClientRect` on the live page.
 *
 * So the geometry is now derived from the content edge rather than from the
 * viewport. The container is `max-w-[1280px]` with 40px padding, so text
 * begins at `50vw - 600px`. The rail is a 56px band ending 20px short of that,
 * which keeps every pixel of it — curve amplitude included — outside the
 * column at every width it renders at.
 *
 * And it only renders from 1400px. Below that the margin is genuinely too
 * narrow to hold a rail without crowding, and a decorative element that has to
 * be squeezed is one that should not be there.
 *
 * Entirely scroll-driven and entirely CSS: `animation-timeline: scroll(root)`
 * on a dash offset. No listener, no rAF, no state, and it runs on the
 * compositor. Without scroll timelines the reader gets the static track, which
 * is a finished thing rather than a broken one.
 */

/**
 * One path, drawn four times. The whole group drifts sideways as the document
 * scrolls, so the rail travels across its band instead of holding one shape.
 */
const CURVE = 'M50 0 C 6 170, 94 300, 50 470 S 6 700, 50 860 S 94 960, 50 1000';

export function PageSpine() {
  return (
    <div className="page-spine" aria-hidden>
      <svg
        className="page-spine__svg"
        viewBox="0 0 100 1000"
        preserveAspectRatio="none"
        focusable="false"
      >
        {/*
          The drift group. Its transform is driven by the document scroll, so
          the curve leans one way through one screen and the other way through
          the next — the rail follows the page rather than decorating it.
        */}
        <g className="page-spine__drift">
          <path
            className="page-spine__track"
            pathLength={1}
            vectorEffect="non-scaling-stroke"
            d={CURVE}
          />
          <path
            className="page-spine__halo"
            pathLength={1}
            vectorEffect="non-scaling-stroke"
            d={CURVE}
          />
          <path
            className="page-spine__trace"
            pathLength={1}
            vectorEffect="non-scaling-stroke"
            d={CURVE}
          />
          {/*
            The node is the same path with a ZERO-length dash and a round cap,
            so the stroke collapses to a single dot riding the trace's leading
            edge. No extra element, no `offset-path`, and it cannot drift off
            the line because it IS the line.
          */}
          <path
            className="page-spine__node"
            pathLength={1}
            vectorEffect="non-scaling-stroke"
            d={CURVE}
          />
        </g>
      </svg>
    </div>
  );
}
