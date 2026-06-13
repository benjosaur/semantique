import pathlib

import gradio as gr

from judge import judge
from level import LEVEL

STATIC = pathlib.Path(__file__).parent / "static"

HEAD = """
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Patrick+Hand&family=Caveat:wght@600;700&display=swap" rel="stylesheet">
"""

# Hide all Gradio chrome: the game component IS the page.
BLOCKS_CSS = """
footer { display: none !important; }
html, body { height: 100%; overflow: hidden; overscroll-behavior: none; }
.gradio-container { padding: 0 !important; max-width: 100% !important; background: #faf8f2 !important; }
.gradio-container .main, .gradio-container .wrap { background: #faf8f2 !important; }
/* Zero Gradio's own wrapper padding so the game sits flush at the top — else a
   ~26px gap pushes the board down and clips the bottom hint off mobile screens. */
.gradio-container .main, .html-container { padding: 0 !important; }
"""

with gr.Blocks(css=BLOCKS_CSS, title="Semantique") as demo:
    game = gr.HTML(
        value=LEVEL,
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
