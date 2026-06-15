import base64
import pathlib

import gradio as gr

from judge import judge
from levels import HOME_ID, LEVEL_ORDER, LEVELS

STATIC = pathlib.Path(__file__).parent / "static"

# The pen-scratch SFX, inlined as a data URI so it needs no static-file route
# (which is brittle inside HF Spaces' iframe). The client decodes it once into
# a Web Audio buffer; see sfx.scratch in game.js.
_SCRATCH = base64.b64encode((STATIC / "pencil-scratch.mp3").read_bytes()).decode()

# The background-music track is far too big to inline like the scratch above
# (a multi-MB loop would bloat every page load), so it streams from the static
# dir via the file route instead. game.js resolves the URL against the Gradio
# root so it still holds up inside the HF Spaces iframe.
gr.set_static_paths(paths=[STATIC])

# A static file streamed via the Gradio file route. game.js resolves the URL
# against the Gradio root so it still holds up inside the HF Spaces iframe.
def _file_route(name: str) -> str:
    return "gradio_api/file=" + str(STATIC / name)


# Each board may name its own background loop (Level.music, a static/ basename);
# resolve those to file-route URLs here so the Level data stays path-agnostic.
# Boards without one play the default loop (Cipher2). game.js crossfades between
# tracks on transition; per-board music_gain keeps them at a matched loudness.
def _level_client(lid: str) -> dict:
    cv = LEVELS[lid].client_value()
    cv["music"] = _file_route(cv["music"]) if cv["music"] else ""
    return cv


# Everything the board needs to render and switch levels client-side: the play
# order, the boot board, each level's client-facing slice, the pen-scratch
# sample (data URI), and the default looping background-music URL (file route).
GAME = {
    "levels": [_level_client(lid) for lid in LEVEL_ORDER],
    "order": LEVEL_ORDER,
    "home": HOME_ID,
    "scratchAudio": "data:audio/mpeg;base64," + _SCRATCH,
    "music": _file_route("Cipher2.mp3"),
}

HEAD = """
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Patrick+Hand&family=Caveat:wght@600;700&display=swap" rel="stylesheet">
"""

# Hide all Gradio chrome: the game component IS the page.
#
# This block (unlike static/style.css, which Gradio injects NESTED under the
# component id) is global, so the bonus board's glitch mode lives here: its
# @keyframes and the page-chrome darkening must reach `html` and `.gradio-container`,
# which a component-scoped rule can't. game.js toggles `.sq-glitch-page` on <html>.
BLOCKS_CSS = """
footer { display: none !important; }
html, body { height: 100%; overflow: hidden; overscroll-behavior: none; }
.gradio-container { padding: 0 !important; max-width: 100% !important; background: #faf8f2 !important; }
.gradio-container .main, .gradio-container .wrap { background: #faf8f2 !important; }
/* Zero Gradio's own wrapper padding so the game sits flush at the top — else a
   ~26px gap pushes the board down and clips the bottom hint off mobile screens. */
.gradio-container .main, .html-container { padding: 0 !important; }

/* Smoothly fade Gradio's paper chrome to dark in glitch mode (matches the eased
   filter flip on .sq-root) so the centred column's side-bars don't glare beside
   the inverted board (the board's paper inverts to ~#05070d). */
.gradio-container, .gradio-container .main, .gradio-container .wrap,
.gradio-container .contain, html, body {
  transition: background 0.85s ease-in-out;
}
html.sq-glitch-page,
html.sq-glitch-page body,
html.sq-glitch-page .gradio-container,
html.sq-glitch-page .gradio-container .main,
html.sq-glitch-page .gradio-container .wrap,
html.sq-glitch-page .gradio-container .contain {
  background: #05070d !important;
}
/* drifting scanlines over the negative, for that decoded-signal hum */
@keyframes sq-scanline {
  from { background-position: 0 0; }
  to { background-position: 0 120px; }
}
/* the victory title's rainbow sweep (the gradient is 200% wide; slide it one
   full gradient-width for a seamless loop). Lives here, un-scoped, because the
   component-nested css_template can't host @keyframes. */
@keyframes sq-rainbow {
  from { background-position: 0% 50%; }
  to { background-position: 200% 50%; }
}
"""

with gr.Blocks(css=BLOCKS_CSS, title="Semantique") as demo:
    game = gr.HTML(
        value=GAME,
        html_template=(STATIC / "game.html").read_text(),
        css_template=(STATIC / "style.css").read_text(),
        js_on_load=(STATIC / "game.js").read_text(),
        head=HEAD,
        server_functions=[judge],
        container=False,
        padding=False,
    )

if __name__ == "__main__":
    demo.launch()
