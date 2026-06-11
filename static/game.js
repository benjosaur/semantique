// Semantique — three.js paper scene inside a single gr.HTML component.
// `element`, `props`, `server` are provided by Gradio; `gsap` is global (head).

(async () => {
  const THREE = await import("https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js");

  const level = props.value; // { grid, start, target, budget, labels }
  const ROWS = level.grid.length;
  const COLS = level.grid[0].length;
  const root = element.querySelector(".sq-root");
  const stage = element.querySelector(".sq-stage");

  const INK = "#1c1b18";
  const INK_SOFT = "#5a564c";

  // ---- HUD ----
  element.querySelector(".sq-target-word").textContent = level.target;
  const pipsEl = element.querySelector(".sq-pips");
  for (let i = 0; i < level.budget; i++) {
    const pip = document.createElement("span");
    pip.className = "sq-pip";
    pip.style.setProperty("--tilt", `${(Math.random() * 8 - 4).toFixed(1)}deg`);
    pipsEl.appendChild(pip);
  }

  // Handwritten font must be loaded before we bake it into canvas textures.
  await Promise.all([
    document.fonts.load('400 80px "Patrick Hand"'),
    document.fonts.ready,
  ]);

  // ---- hand-drawn canvas helpers ----

  const rand = (a, b) => a + Math.random() * (b - a);

  // A rounded-rect path drawn as short jittered segments — wobbly ink line.
  function wobblyRoundRect(ctx, x, y, w, h, r, jitter) {
    const pts = [];
    const seg = 14; // sample points per edge
    const corner = (cx, cy, a0, a1) => {
      for (let i = 0; i <= 6; i++) {
        const a = a0 + (a1 - a0) * (i / 6);
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    };
    const edge = (x0, y0, x1, y1) => {
      for (let i = 1; i < seg; i++) {
        const t = i / seg;
        pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      }
    };
    corner(x + r, y + r, Math.PI, Math.PI * 1.5);
    edge(x + r, y, x + w - r, y);
    corner(x + w - r, y + r, Math.PI * 1.5, Math.PI * 2);
    edge(x + w, y + r, x + w, y + h - r);
    corner(x + w - r, y + h - r, 0, Math.PI * 0.5);
    edge(x + w - r, y + h, x + r, y + h);
    corner(x + r, y + h - r, Math.PI * 0.5, Math.PI);
    edge(x, y + h - r, x, y + r);

    ctx.beginPath();
    pts.forEach(([px, py], i) => {
      const jx = px + rand(-jitter, jitter);
      const jy = py + rand(-jitter, jitter);
      i === 0 ? ctx.moveTo(jx, jy) : ctx.lineTo(jx, jy);
    });
    ctx.closePath();
  }

  const TILE_PX = 384; // texture resolution per tile

  function drawTileCanvas(ctx, word) {
    const special = word === "<bos>" || word === "<eos>";
    ctx.clearRect(0, 0, TILE_PX, TILE_PX);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // paper fill so tiles sit on the ruled background
    wobblyRoundRect(ctx, 26, 26, TILE_PX - 52, TILE_PX - 52, 56, 3);
    ctx.fillStyle = "rgba(255, 253, 247, 0.92)";
    ctx.fill();

    // double ink stroke = "traced twice" feel
    ctx.strokeStyle = special ? INK_SOFT : INK;
    ctx.setLineDash(special ? [16, 13] : []);
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.setLineDash([]);
    wobblyRoundRect(ctx, 26, 26, TILE_PX - 52, TILE_PX - 52, 56, 4.5);
    ctx.strokeStyle = special ? "rgba(90,86,76,0.35)" : "rgba(28,27,24,0.35)";
    ctx.lineWidth = 4;
    ctx.stroke();

    // the word
    ctx.fillStyle = special ? INK_SOFT : INK;
    let size = word.length > 6 ? 64 : 76;
    ctx.font = `400 ${size}px "Patrick Hand"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(word, TILE_PX / 2 + rand(-2, 2), TILE_PX / 2 + rand(-1, 3));
  }

  // ---- three.js paper scene ----
  const scene = new THREE.Scene(); // transparent: CSS paper + ruled lines show through

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, 10, 7);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  stage.appendChild(renderer.domElement);

  // Board group: everything sits here, slightly slanted like a sketch.
  const board = new THREE.Group();
  board.rotation.y = THREE.MathUtils.degToRad(1.5);
  scene.add(board);

  // ---- tiles ----
  const SPACING = 1.5;
  const TILE_SIZE = 1.32;
  const tileAt = (r, c) => ({
    x: (c - (COLS - 1) / 2) * SPACING,
    z: (r - (ROWS - 1) / 2) * SPACING,
  });

  const tiles = []; // { mesh, ctx, texture, word, row, col }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const word = level.grid[r][c];
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = TILE_PX;
      const ctx = canvas.getContext("2d");
      drawTileCanvas(ctx, word);

      const texture = new THREE.CanvasTexture(canvas);
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      texture.colorSpace = THREE.SRGBColorSpace;

      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true })
      );
      mesh.rotation.x = -Math.PI / 2; // lie flat on the table
      const { x, z } = tileAt(r, c);
      mesh.position.set(x, 0, z);
      board.add(mesh);
      tiles.push({ mesh, ctx, texture, word, row: r, col: c });
    }
  }
  const tile = (r, c) => tiles[r * COLS + c];

  // "Sketch boil": re-jitter the ink a few times a second so it feels alive.
  setInterval(() => {
    if (document.hidden) return;
    for (const t of tiles) {
      drawTileCanvas(t.ctx, t.word);
      t.texture.needsUpdate = true;
    }
  }, 340);

  // ---- camera framing ----
  const VIEW = 7.0; // world units visible vertically
  function resize() {
    const w = stage.clientWidth || 1;
    const h = stage.clientHeight || 1;
    const aspect = w / h;
    const vh = Math.max(VIEW, 6.8 / aspect); // keep the board inside narrow windows
    camera.left = (-vh * aspect) / 2;
    camera.right = (vh * aspect) / 2;
    camera.top = vh / 2;
    camera.bottom = -vh / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  renderer.setAnimationLoop(() => renderer.render(scene, camera));

  root.dataset.state = "ready";
})();
