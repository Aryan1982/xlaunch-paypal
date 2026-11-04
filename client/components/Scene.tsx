/** The 2D and 3D backdrops; the nearest [data-mode] ancestor picks which shows (globals.css). */
export function Scene() {
  return (
    <div className="scene" aria-hidden>
      <div className="scene-layer scene-2d" />
      <div className="scene-layer scene-3d" />
    </div>
  );
}
