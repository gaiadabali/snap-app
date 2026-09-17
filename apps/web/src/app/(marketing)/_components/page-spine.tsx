/**
 * The reading rail — a curve down the left gutter that draws itself as you
 * scroll.
 *
 * The first version was a straight 1px hairline pinned at the gutter x, and it
 * read as disruptive for a reason worth writing down: a perfectly straight
 * vertical line at full page height competes with the text column as a second
 * edge, and because it never changes it gives the eye nothing to do except
 * notice it. A curve is quieter. It drifts a few pixels across the gutter,
 * never repeats the same x beside two sections, and reads as an object the
 * page is threaded onto rather than a border someone left on.
 *
 * It is also now the ONLY progress indicator. The header carried a second one
 * reporting the identical quantity; two trackers for one fact is worse than
 * one, because a reader has to check whether they agree.
 *
 * Entirely scroll-driven and entirely CSS — `animation-timeline: scroll(root)`
 * on a dash offset. No listener, no rAF, no state, and it runs on the
 * compositor. A browser without scroll timelines gets the static track and
 * nothing else, which is a finished thing rather than a broken one.
 */
export function PageSpine() {
  return (
    <div className="page-spine" aria-hidden>
      <svg
        className="page-spine__svg"
        viewBox="0 0 80 1000"
        preserveAspectRatio="none"
        focusable="false"
      >
        {/*
          `pathLength="1"` normalises the geometry so the dash maths is just
          0 → 1 regardless of how long the curve actually is, and
          `vector-effect` keeps the stroke hairline-thin despite the
          non-uniform scale that stretches this box to the viewport height.
        */}
        <path
          className="page-spine__track"
          pathLength={1}
          vectorEffect="non-scaling-stroke"
          d="M40 0 C 14 190, 66 330, 40 500 S 14 810, 40 1000"
        />
        <path
          className="page-spine__trace"
          pathLength={1}
          vectorEffect="non-scaling-stroke"
          d="M40 0 C 14 190, 66 330, 40 500 S 14 810, 40 1000"
        />
      </svg>
    </div>
  );
}
