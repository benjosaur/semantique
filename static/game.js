// Semantique — three.js paper scene inside a single gr.HTML component.
// `element`, `props`, `server` are provided by Gradio; `gsap` is global (head).

(async () => {
  // Gradio ships its own viewport meta; update that single tag (don't add a
  // second) to lock zoom so swipes can't pinch/double-tap-zoom the board.
  {
    let vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement("meta");
      vp.name = "viewport";
      document.head.appendChild(vp);
    }
    vp.content =
      "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
  }

  // ---- embed fit (HF Spaces) ----
  // HF serves the Space inside an iframe driven by iframe-resizer, which sizes
  // the iframe to its content. Our `100dvh` root then resolves to the iframe's
  // OWN height, so every measure-and-grow cycle makes the content taller — the
  // iframe balloons without bound and the (vertically centered) board ends up
  // thousands of px below the fold: "it all drags down". Localhost has no
  // iframe, so `100dvh` is the real window and this branch never runs.
  // Fix: let the document be content-height and pin the game to a fixed pixel
  // height — the parent's visible viewport — so the iframe settles instead of
  // feeding back on itself.
  if (window.self !== window.top) {
    const rootEl = element.querySelector(".sq-root");
    document.documentElement.style.height = document.body.style.height = "auto";
    const fit = (h) => h > 0 && (rootEl.style.height = Math.round(h) + "px");
    // Instant pin, before the resizer API is ready; cap by the screen so any
    // runaway that already started can't lock in a giant value.
    fit(Math.min(window.innerHeight, window.screen.height || Infinity));
    // Gradio's shell (.main.fillable / .wrap / .contain) sits a few constant px
    // taller than our component, so the iframe-resizer measures `root + chrome`.
    // Size root so the WHOLE document equals the slot: subtract that measured
    // excess. Cached so repeat getPageInfo events don't oscillate.
    let chrome = 0, lastKey = "";
    const apply = (info) => {
      // Available slot = parent viewport minus how far the iframe sits below the
      // top (HF's header). Deliberately SCROLL-INVARIANT: clientHeight and
      // offsetTop don't change as the parent scrolls, only scrollTop does — so
      // folding scrollTop in (as we used to) refit the board on every scroll
      // tick, resizing and REALLOCATING the WebGL drawing buffer each time. That
      // was the "lags much more on HF" jank, and the board reframing mid-scroll
      // is what clipped the keycap text. Keep avail off scrollTop and the
      // constant getPageInfo scroll events collapse into no-ops below.
      const avail = Math.max(0, info.clientHeight - info.offsetTop);
      const key = avail + "x" + info.clientWidth;
      if (key === lastKey) return; // viewport unchanged — a pure scroll, skip
      lastKey = key;
      fit(avail - chrome);
      requestAnimationFrame(() => {
        const excess = document.body.offsetHeight - rootEl.offsetHeight;
        if (excess >= 0 && excess !== chrome) { chrome = excess; fit(avail - chrome); }
      });
    };
    // getPageInfo re-fires on parent scroll/resize; a genuine viewport change
    // (rotating phone, collapsing mobile URL bar) shifts clientHeight and refits,
    // while plain scrolling now no-ops via the key guard above.
    const poll = setInterval(() => {
      if (!window.parentIFrame) return;
      clearInterval(poll);
      window.parentIFrame.getPageInfo(apply);
    }, 50);
    setTimeout(() => clearInterval(poll), 5000); // give up waiting for the API
  }

  const THREE = await import("https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js");

  // props.value: { levels: [clientValue...], order: [id...], home: id }
  const data = props.value;
  const LEVELS = Object.fromEntries(data.levels.map((l) => [l.id, l]));
  const ORDER = data.order;
  let level = LEVELS[data.home]; // the active board; swapped by loadLevel()
  let ROWS = level.grid.length;
  let COLS = level.grid[0].length;
  // Checked-off targets persist per board across switches and rounds.
  const checkedByLevel = Object.fromEntries(data.levels.map((l) => [l.id, new Set()]));
  const root = element.querySelector(".sq-root");
  const stage = element.querySelector(".sq-stage");

  const INK = "#1c1b18";
  const INK_SOFT = "#5a564c";
  const ACCENT = "#b3402e";

  // A grid cell appends its word unless it's structural (start / blank / ⏎ / wings / portal).
  const appendsWord = (w) => w && w !== "start" && w !== "⏎" && w !== "wings" && w !== "portal";

  // ---- HUD ----
  // The targets checklist: every label to collect. Checks persist per board
  // across rounds ("hop again" keeps them), so the meta-game is collecting all.
  const targetListEl = element.querySelector(".sq-target-list");
  let targetItems = {}; // label -> chip element, rebuilt per board
  const checkedOnThisLevel = () => checkedByLevel[level.id];
  const remainingTargets = () => level.targets.filter((t) => !checkedOnThisLevel().has(t));

  // (Re)build the checklist for the active board, restoring any persisted checks.
  function buildTargets() {
    targetListEl.innerHTML = "";
    targetItems = {};
    const checked = checkedOnThisLevel();
    for (const label of level.targets) {
      const item = document.createElement("span");
      item.className = "sq-target-item";
      item.style.setProperty("--tilt", `${(Math.random() * 4 - 2.5).toFixed(1)}deg`);
      item.appendChild(document.createTextNode(label));
      if (checked.has(label)) item.classList.add("sq-checked");
      targetListEl.appendChild(item);
      targetItems[label] = item;
    }
    element.querySelector(".sq-ctx-cap").textContent = level.budget;
  }

  function checkOff(label) {
    checkedOnThisLevel().add(label);
    const item = targetItems[label];
    item.classList.add("sq-checked"); // fades + strikes the word through
    gsap.fromTo(item, { scale: 1.3 }, { scale: 1, duration: 0.3, ease: "back.out(2)" });
    // collecting the last target completes the board — reveal the forward swap tile
    if (remainingTargets().length === 0) revealForwardSwap();
  }

  // The hop counter: a plain "N/budget" counter that ticks up each hop.
  // (The cap text is set per board in buildTargets.)
  const countEl = element.querySelector(".sq-context-count");
  const usedEl = element.querySelector(".sq-ctx-used");
  const hud = {
    update(used) {
      usedEl.textContent = used;
    },
    warnFull() {
      sfx.warn();
      countEl.classList.add("sq-full");
      gsap.to(countEl, { x: "+=3", yoyo: true, repeat: 5, duration: 0.05 });
    },
    overflow() {
      usedEl.textContent = level.budget + 1;
      countEl.classList.add("sq-full");
    },
    reset() {
      usedEl.textContent = 0;
      countEl.classList.remove("sq-full");
    },
  };

  // Fonts must be loaded before we bake Patrick Hand into canvas textures AND
  // before the HUD/prompt/card lay out their Caveat text — otherwise the DOM
  // text renders in a fallback face, then reflows when the webfont lands.
  // document.fonts.ready alone is unreliable here: the Google Fonts stylesheet
  // arrives async, and `ready` only waits for faces already in active use, so
  // Caveat 600 (the verdict card) isn't covered. Request every weight we use.
  await Promise.all([
    document.fonts.load('400 80px "Patrick Hand"'),
    document.fonts.load('700 42px "Caveat"'),
    document.fonts.load('600 34px "Caveat"'),
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

  const TILE_PX = 384; // logical texture units per tile
  // Canvas textures are baked at devicePixelRatio so words and ink lines stay
  // crisp on hidpi screens (all drawing keeps using logical coordinates).
  const TEX_SCALE = Math.min(window.devicePixelRatio || 1, 2);

  // The bare keycap face: opaque paper base + the wobbly double-stroke rim that
  // doubles as the 3D silhouette (the extruded body follows this outline).
  // `special` softens the ink (start / ⏎ / swap); `dashed` adds the "press me"
  // dashed rim (the submit and swap tiles — the start tile stays solid).
  function drawKeycapBase(ctx, special, dashed) {
    ctx.setTransform(TEX_SCALE, 0, 0, TEX_SCALE, 0, 0);
    // opaque paper base — the keycap body is the rounded outline itself now,
    // so this whole canvas IS the cap face (extruded silhouette clips it)
    ctx.fillStyle = "#faf8f2";
    ctx.fillRect(0, 0, TILE_PX, TILE_PX);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // the ink line sits AT the geometry's rim — outer jitter clips against the
    // extruded silhouette, so the drawn outline and the 3D edge are one line
    const inset = 5;
    const span = TILE_PX - inset * 2;
    const cr = Math.round(span * 0.17);
    wobblyRoundRect(ctx, inset, inset, span, span, cr, 3);
    ctx.fillStyle = "rgba(255, 253, 247, 0.92)";
    ctx.fill();

    // double ink stroke = "traced twice" feel
    ctx.strokeStyle = special ? INK_SOFT : INK;
    ctx.setLineDash(dashed ? [16, 13] : []);
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.setLineDash([]);
    wobblyRoundRect(ctx, inset, inset, span, span, cr, 4.5);
    ctx.strokeStyle = special ? "rgba(90,86,76,0.35)" : "rgba(28,27,24,0.35)";
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  // A wings keycap: a stamped pair of spread wings in accent ink — the "lift
  // off" tile. Hopping onto it sprouts the doodle's wings and sends it airborne.
  function drawWingsKeyIcon(ctx) {
    const cx = TILE_PX / 2, cy = 200;
    ctx.lineJoin = ctx.lineCap = "round";
    for (const sign of [-1, 1]) {
      const ax = cx + sign * 14, ay = cy + 6; // wing root, near the centre
      const tipx = ax + sign * 128, tipy = cy - 70;
      const elbx = cx + sign * 84, elby = cy - 40;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(elbx, elby - 40, tipx, tipy); // leading edge up to the tip
      // scalloped trailing edge (feathers) back to the root
      ctx.quadraticCurveTo(cx + sign * 96, cy + 6, cx + sign * 70, cy + 24);
      ctx.quadraticCurveTo(cx + sign * 58, cy + 4, cx + sign * 44, cy + 32);
      ctx.quadraticCurveTo(cx + sign * 34, cy + 10, ax, ay);
      ctx.closePath();
      ctx.fillStyle = "rgba(255,253,247,0.92)";
      ctx.fill();
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 9;
      ctx.stroke();
      // a couple of feather divider strokes
      ctx.lineWidth = 4.5;
      wobblyLine(ctx, ax + sign * 10, ay - 8, elbx, elby + 4, 2); ctx.stroke();
      wobblyLine(ctx, ax + sign * 26, ay + 2, elbx + sign * 8, elby + 22, 2); ctx.stroke();
    }
  }

  function drawTileCanvas(ctx, word) {
    const special = word === "start" || word === "⏎" || word === "wings" || word === "portal";
    // only the submit tile keeps a dashed rim as a "press me" cue; the start,
    // wings and portal tiles read as normal solid keycaps.
    drawKeycapBase(ctx, special, word === "⏎");

    // the wings tile is wordless — its icon IS the cue.
    if (word === "wings") return drawWingsKeyIcon(ctx);

    // the word — start/empty/portal tiles are blank squares (the portal's spiral
    // is a separate spinning mesh), so they stay wordless
    const blank = !word || word === "start" || word === "portal";
    if (!blank) {
      ctx.fillStyle = special ? INK_SOFT : INK;
      let size = word.length > 6 ? 64 : 76;
      ctx.font = `400 ${size}px "Patrick Hand"`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(word, TILE_PX / 2 + rand(-2, 2), TILE_PX / 2 + rand(-1, 3));
    }
  }

  // A board-swap keycap: a special dashed cap stamped with a big accent arrow
  // (→, to the next board) and the destination board's title below.
  function drawSwapTileCanvas(ctx, dir, label) {
    drawKeycapBase(ctx, true, true);
    const cx = TILE_PX / 2;
    const ay = 150; // arrow centre line
    const half = 78;
    const tail = cx - dir * half;
    const tip = cx + dir * half;
    ctx.strokeStyle = ACCENT;
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.lineWidth = 20;
    wobblyLine(ctx, tail, ay, tip, ay, 4); ctx.stroke(); // shaft
    wobblyLine(ctx, tip, ay, tip - dir * 58, ay - 48, 3); ctx.stroke(); // upper barb
    wobblyLine(ctx, tip, ay, tip - dir * 58, ay + 48, 3); ctx.stroke(); // lower barb

    if (label) {
      ctx.fillStyle = INK;
      const size = label.length > 7 ? 56 : 64;
      ctx.font = `400 ${size}px "Patrick Hand"`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, cx + rand(-2, 2), 268 + rand(-1, 2));
    }
  }

  // Keycap sides: same paper as the cap so the button reads as ONE drawn
  // object — hatch shading for depth and a bold ink line along the bottom
  // silhouette (the cap's ring already inks the top edge; no second rim).
  const SIDE_PX_W = 384;
  const SIDE_PX_H = 128;

  function drawTileSideCanvas(ctx) {
    ctx.setTransform(TEX_SCALE, 0, 0, TEX_SCALE, 0, 0);
    ctx.fillStyle = "#faf8f2";
    ctx.fillRect(0, 0, SIDE_PX_W, SIDE_PX_H);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    ctx.strokeStyle = "rgba(28,27,24,0.13)";
    ctx.lineWidth = 5;
    for (let x = rand(8, 44); x < SIDE_PX_W; x += rand(52, 84)) {
      wobblyLine(ctx, x, SIDE_PX_H - 12, x + 67, 14, 2); // ~-55° up-right
      ctx.stroke();
    }

    // bottom outline — wraps the whole silhouette via the side-wall UVs
    ctx.strokeStyle = INK;
    ctx.lineWidth = 7;
    wobblyLine(ctx, -6, SIDE_PX_H - 7, SIDE_PX_W + 6, SIDE_PX_H - 7, 2.5);
    ctx.stroke();
  }

  // The portal spiral: a hand-drawn Archimedean coil on a transparent square,
  // baked once and worn by every portal keycap (a disc that spins it in place —
  // see the animation loop). Drawn ink-on-paper to match the keycaps: an accent
  // under-stroke, a double ink pass for the "traced twice" feel, and a filled
  // dot at the eye so the swirl reads as a hole to drop into.
  const SPIRAL_PX = 256;
  function drawSpiralCanvas(ctx) {
    ctx.setTransform(TEX_SCALE, 0, 0, TEX_SCALE, 0, 0);
    ctx.clearRect(0, 0, SPIRAL_PX, SPIRAL_PX);
    ctx.lineJoin = ctx.lineCap = "round";
    const cx = SPIRAL_PX / 2, cy = SPIRAL_PX / 2;
    const path = (jit) => {
      const turns = 3.0, maxR = SPIRAL_PX * 0.4, steps = 200;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = t * Math.PI * 2 * turns;
        const r = 7 + t * maxR;
        const x = cx + r * Math.cos(a) + rand(-jit, jit);
        const y = cy + r * Math.sin(a) + rand(-jit, jit);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
    };
    ctx.globalAlpha = 0.5; // accent under-spiral, slightly fatter
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 11; path(2); ctx.stroke();
    ctx.globalAlpha = 1; // ink spiral, traced twice
    ctx.strokeStyle = INK; ctx.lineWidth = 6; path(2.4); ctx.stroke();
    ctx.strokeStyle = "rgba(28,27,24,0.4)"; ctx.lineWidth = 3; path(1.4); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); // the eye of the portal
    ctx.fillStyle = INK; ctx.fill();
  }

  // ---- three.js paper scene ----
  const scene = new THREE.Scene(); // transparent: CSS paper + ruled lines show through

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, -0.9, 11.5); // slightly below-front: keycap sides read
  camera.lookAt(0, 0.25, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  // Render the framebuffer at the device's pixel density (capped at 3 to bound
  // fill-rate). Phones are dpr 3, so the old cap of 2 rendered at 2x and let the
  // browser upscale to the 3x screen — the whole board looked soft ("low-rez")
  // on mobile, more so now the board fills more of the width. The keycap TEXTURES
  // stay capped at 2x (TEX_SCALE): a 768px tile texture already oversamples the
  // on-screen tile, so a 3x texture would only add memory + boil-redraw cost.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
  stage.appendChild(renderer.domElement);

  // Tilt group: the whole board leans away from the viewer, 22° back from
  // vertical, like a keyboard propped up on a desk.
  const boardTilt = new THREE.Group();
  boardTilt.rotation.x = THREE.MathUtils.degToRad(68);
  scene.add(boardTilt);

  // Board group: everything sits here, slightly slanted like a sketch.
  const board = new THREE.Group();
  board.rotation.z = THREE.MathUtils.degToRad(1.5);
  boardTilt.add(board);

  // ---- tiles ----
  const SPACING = 1.5;
  const TILE_SIZE = 1.32;
  const tileAt = (r, c) => ({
    x: (c - (COLS - 1) / 2) * SPACING,
    z: (r - (ROWS - 1) / 2) * SPACING,
  });

  // Tiles are keycaps: an extruded rounded-rect silhouette — the 3D body
  // follows the drawn outline directly (no square box behind it). The TOP
  // FACE sits at y=0, so the old "tile surface" coordinates still mean the
  // same thing.
  const TILE_DEPTH = 0.42;
  const TILE_R = TILE_SIZE * 0.17; // corner radius — the ink line traces it
  const tileShape = new THREE.Shape();
  {
    const h = TILE_SIZE / 2;
    tileShape.moveTo(-h + TILE_R, -h);
    tileShape.lineTo(h - TILE_R, -h);
    tileShape.quadraticCurveTo(h, -h, h, -h + TILE_R);
    tileShape.lineTo(h, h - TILE_R);
    tileShape.quadraticCurveTo(h, h, h - TILE_R, h);
    tileShape.lineTo(-h + TILE_R, h);
    tileShape.quadraticCurveTo(-h, h, -h, h - TILE_R);
    tileShape.lineTo(-h, -h + TILE_R);
    tileShape.quadraticCurveTo(-h, -h, -h + TILE_R, -h);
  }
  const tileGeometry = new THREE.ExtrudeGeometry(tileShape, {
    depth: TILE_DEPTH,
    bevelEnabled: false,
    curveSegments: 6,
  });
  // Extrude UVs come out in shape units, not 0..1 — remap the caps to span
  // the texture, and the side wall so v runs bottom→top (ink rim at the top).
  {
    const pos = tileGeometry.attributes.position;
    const uv = tileGeometry.attributes.uv;
    const [caps, walls] = tileGeometry.groups;
    for (let i = caps.start; i < caps.start + caps.count; i++) {
      uv.setXY(i, pos.getX(i) / TILE_SIZE + 0.5, pos.getY(i) / TILE_SIZE + 0.5);
    }
    for (let i = walls.start; i < walls.start + walls.count; i++) {
      uv.setXY(i, uv.getX(i) / TILE_SIZE + 0.5, pos.getZ(i) / TILE_DEPTH);
    }
  }
  // Shape lies in XY, extruded toward +z — stand it up so the cap faces +y
  // with the top surface at local y=+TILE_DEPTH/2 (mesh y stays -TILE_DEPTH/2).
  tileGeometry.rotateX(-Math.PI / 2);
  tileGeometry.translate(0, -TILE_DEPTH / 2, 0);

  // One shared side texture/material for all 16 keycaps.
  const sideCanvas = document.createElement("canvas");
  sideCanvas.width = SIDE_PX_W * TEX_SCALE;
  sideCanvas.height = SIDE_PX_H * TEX_SCALE;
  const sideCtx = sideCanvas.getContext("2d");
  drawTileSideCanvas(sideCtx);
  const sideTexture = new THREE.CanvasTexture(sideCanvas);
  sideTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  sideTexture.colorSpace = THREE.SRGBColorSpace;
  const sideMaterial = new THREE.MeshBasicMaterial({ map: sideTexture });

  // One shared spiral disc, reused by every portal keycap. A flat plane wearing
  // the baked spiral texture, lying face-up just above the cap top; each portal
  // gets its own Mesh (so it can spin independently) but they share this
  // geometry/texture/material — the spin lives on the mesh, not the texture.
  const SPIRAL_LIFT = 0.02; // height above the keycap top, so it never z-fights
  const spiralCanvas = document.createElement("canvas");
  spiralCanvas.width = spiralCanvas.height = SPIRAL_PX * TEX_SCALE;
  drawSpiralCanvas(spiralCanvas.getContext("2d"));
  const spiralTexture = new THREE.CanvasTexture(spiralCanvas);
  spiralTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  spiralTexture.colorSpace = THREE.SRGBColorSpace;
  const spiralMaterial = new THREE.MeshBasicMaterial({
    map: spiralTexture, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const spiralGeometry = new THREE.PlaneGeometry(TILE_SIZE * 0.9, TILE_SIZE * 0.9);
  spiralGeometry.rotateX(-Math.PI / 2); // lie flat, facing +y like the keycap top

  let tiles = []; // { mesh, ctx, texture, word, row, col, spinner }
  let portalSpinners = []; // the spinning spiral discs, spun by the render loop
  let portalDest = {}; // "r,c" -> [row,col] of the next portal clockwise
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // (Re)build the keycaps for the active board, disposing the previous set.
  function buildTiles() {
    for (const t of tiles) {
      board.remove(t.mesh);
      t.texture.dispose();
      t.mesh.material[0].dispose(); // per-tile cap material (side is shared)
    }
    tiles = [];
    portalSpinners = []; // children of their tile meshes — disposed with them
    ROWS = level.grid.length;
    COLS = level.grid[0].length;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const word = level.grid[r][c];
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = TILE_PX * TEX_SCALE;
        const ctx = canvas.getContext("2d");
        drawTileCanvas(ctx, word);

        const texture = new THREE.CanvasTexture(canvas);
        texture.anisotropy = maxAniso;
        texture.colorSpace = THREE.SRGBColorSpace;

        // ExtrudeGeometry groups: [0] = caps (top + hidden bottom), [1] = side wall
        const mesh = new THREE.Mesh(tileGeometry, [
          new THREE.MeshBasicMaterial({ map: texture, transparent: false }),
          sideMaterial,
        ]);
        const { x, z } = tileAt(r, c);
        mesh.position.set(x, -TILE_DEPTH / 2, z); // top face flush with y=0
        board.add(mesh);

        // a portal wears a spinning spiral disc just above its keycap top. It's
        // a child of the keycap, so it drops/presses/disposes with the tile.
        let spinner = null;
        if (word === "portal") {
          spinner = new THREE.Mesh(spiralGeometry, spiralMaterial);
          spinner.position.y = TILE_DEPTH / 2 + SPIRAL_LIFT; // above the top face (mesh-local)
          mesh.add(spinner);
          portalSpinners.push(spinner);
        }
        tiles.push({ mesh, ctx, texture, word, row: r, col: c, spinner });
      }
    }
    buildPortalLinks();
  }
  const tile = (r, c) => tiles[r * COLS + c];

  // Wire each portal to the next one clockwise around the board centre. Angle is
  // measured in screen space (x = col, y = up = -row); clockwise is decreasing
  // angle, so portals sorted by descending angle each point at the one after.
  function buildPortalLinks() {
    portalDest = {};
    const cells = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (level.grid[r][c] === "portal") cells.push([r, c]);
    if (cells.length < 2) return; // a lone portal links nowhere
    const cr = (ROWS - 1) / 2, cc = (COLS - 1) / 2;
    const ang = ([r, c]) => Math.atan2(cr - r, c - cc);
    cells.sort((a, b) => ang(b) - ang(a)); // descending angle = clockwise
    for (let i = 0; i < cells.length; i++) {
      const [fr, fc] = cells[i];
      portalDest[fr + "," + fc] = cells[(i + 1) % cells.length];
    }
  }

  // ---- board-swap tiles ----
  // Lone keycaps just off the grid edge: hop onto one and it loads another
  // board. They live OUTSIDE the rectangular `tiles` array (so the r*COLS+c
  // index math is untouched) at virtual cells (startRow, COLS) / (startRow, -1),
  // pushed an extra SWAP_GAP out so they read as a tile "by itself".
  let swapTiles = []; // { mesh, ctx, texture, row, col, targetId, dir, active, x, z, label }
  const SWAP_GAP = 0.55;
  const swapTileAt = (r, c) =>
    swapTiles.find((s) => s.active && s.row === r && s.col === c) || null;

  function addSwapTile(row, col, targetId, dir, active) {
    const label = LEVELS[targetId].title;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = TILE_PX * TEX_SCALE;
    const ctx = canvas.getContext("2d");
    drawSwapTileCanvas(ctx, dir, label);

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = maxAniso;
    texture.colorSpace = THREE.SRGBColorSpace;

    const mesh = new THREE.Mesh(tileGeometry, [
      new THREE.MeshBasicMaterial({ map: texture, transparent: false }),
      sideMaterial,
    ]);
    const base = tileAt(row, col);
    const x = base.x + dir * SWAP_GAP;
    const z = base.z;
    mesh.position.set(x, -TILE_DEPTH / 2, z);
    mesh.visible = active;
    board.add(mesh);
    swapTiles.push({ mesh, ctx, texture, row, col, targetId, dir, active, x, z, label });
  }

  // (Re)build the swap tile for the active board: a single forward tile, shown
  // once every target here is collected, that progresses to the next board.
  // Progression is one-way — there is no back tile. The grid stays centred on
  // its own; the lone swap tile sits just off the right edge without shifting
  // the board, so the visible grid reads centred from the start.
  function buildSwapTiles() {
    for (const s of swapTiles) {
      board.remove(s.mesh);
      s.texture.dispose();
      s.mesh.material[0].dispose(); // per-tile cap material (side is shared)
    }
    swapTiles = [];
    const i = ORDER.indexOf(level.id);
    const hasNext = i < ORDER.length - 1;
    if (hasNext) {
      addSwapTile(level.start[0], COLS, ORDER[i + 1], +1, remainingTargets().length === 0);
    }
    board.position.x = 0; // grid stays centred; the swap tile never decentres it
  }

  // Board complete: poof the forward swap tile in so the doodle can hop onward.
  function revealForwardSwap() {
    const s = swapTiles.find((t) => t.dir > 0 && !t.active);
    if (!s) return;
    s.active = true;
    s.mesh.visible = true;
    sfx.pop();
    gsap.fromTo(
      s.mesh.scale,
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1, duration: 0.45, ease: "back.out(2)" }
    );
  }

  // Depress a keycap and let it spring back, like the doodle typed it.
  function pressTile(t) {
    sfx.press();
    gsap.timeline()
      .to(t.mesh.position, { y: -TILE_DEPTH / 2 - 0.14, duration: 0.07, ease: "power2.out" })
      .to(t.mesh.position, { y: -TILE_DEPTH / 2, duration: 0.3, ease: "back.out(2.2)" });
  }

  // ---- character: a line-doodle on a billboarded plane ----

  function wobblyCircle(ctx, cx, cy, r, jitter) {
    ctx.beginPath();
    for (let i = 0; i <= 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const rr = r + rand(-jitter, jitter);
      const x = cx + rr * Math.cos(a);
      const y = cy + rr * Math.sin(a);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function wobblyLine(ctx, x0, y0, x1, y1, jitter) {
    ctx.beginPath();
    ctx.moveTo(x0 + rand(-jitter, jitter), y0 + rand(-jitter, jitter));
    const mx = (x0 + x1) / 2 + rand(-jitter * 2, jitter * 2);
    const my = (y0 + y1) / 2 + rand(-jitter * 2, jitter * 2);
    ctx.quadraticCurveTo(mx, my, x1 + rand(-jitter, jitter), y1 + rand(-jitter, jitter));
  }

  const CHAR_PX_W = 256;
  const CHAR_PX_H = 320;

  // One outlined "tube" limb: a jittered quadratic stroked twice — fat ink,
  // then a thin paper core — so arms/legs read as drawn shapes, not sticks.
  function limb(ctx, x0, y0, cx, cy, x1, y1) {
    const J = 2.5;
    ctx.beginPath();
    ctx.moveTo(x0 + rand(-J, J), y0 + rand(-J, J));
    ctx.quadraticCurveTo(cx + rand(-J, J), cy + rand(-J, J), x1 + rand(-J, J), y1 + rand(-J, J));
    ctx.strokeStyle = INK;
    ctx.lineWidth = 16;
    ctx.stroke();
    ctx.strokeStyle = "#fffdf7";
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = INK;
  }

  // Flat doodle shoe: a small ink-filled ellipse at the end of a leg.
  function charFoot(ctx, x, y) {
    ctx.beginPath();
    ctx.ellipse(x + rand(-2, 2), y + rand(-1.5, 1.5), 9, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
  }

  // Mitten hand: a paper-filled wobbly circle with an ink outline.
  function charHand(ctx, x, y) {
    wobblyCircle(ctx, x, y, 9, 1.5);
    ctx.fillStyle = "#fffdf7";
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }

  // Dazed X eye: two short crossed strokes.
  function xEye(ctx, cx, cy) {
    ctx.lineWidth = 4.5;
    wobblyLine(ctx, cx - 7, cy - 7, cx + 7, cy + 7, 1); ctx.stroke();
    wobblyLine(ctx, cx - 7, cy + 7, cx + 7, cy - 7, 1); ctx.stroke();
  }

  // One feathered wing for the airborne doodle. `phase` 0..3 is the slow flap
  // frame (0 = wings low/spread, 3 = wings raised); `sign` mirrors left/right
  // about the body centre (x≈128). Drawn behind the torso so the roots tuck in.
  let wingPhase = 0;
  function oneWing(ctx, sign, phase) {
    const up = phase / 3;
    const ax = 128 + sign * 16, ay = 150; // root near the shoulder
    const tipx = ax + sign * (54 + up * 6);
    const tipy = ay - 18 - up * 66; // the tip swings up as it flaps
    const elbx = ax + sign * 40, elby = ay - 8 - up * 30;
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(ax, ay - 4);
    ctx.quadraticCurveTo(elbx, elby - 24, tipx, tipy); // leading edge → tip
    ctx.quadraticCurveTo(elbx - sign * 2, elby + 14, ax + sign * 4, ay + 18); // trailing edge back
    ctx.closePath();
    ctx.fillStyle = "rgba(255,253,247,0.95)";
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.lineWidth = 3; // two feather strokes
    wobblyLine(ctx, ax + sign * 8, ay - 2, elbx, elby - 6, 1.5); ctx.stroke();
    wobblyLine(ctx, ax + sign * 16, ay + 4, elbx + sign * 4, elby + 6, 1.5); ctx.stroke();
  }
  function drawWings(ctx, phase) {
    oneWing(ctx, -1, phase);
    oneWing(ctx, 1, phase);
  }

  function drawCharCanvas(ctx, pose) {
    const J = 2.5;
    ctx.setTransform(TEX_SCALE, 0, 0, TEX_SCALE, 0, 0);
    ctx.clearRect(0, 0, CHAR_PX_W, CHAR_PX_H);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = 7;

    // wings ride behind the body, so paint them before the limbs/torso cover the roots
    if (pose === "fly") drawWings(ctx, wingPhase);

    // limbs first, so the torso fill covers the shoulder/hip joins.
    // shoulders ~(104,142)/(152,142), hips ~(112,205)/(144,205), feet base y≈308
    if (pose === "think") {
      limb(ctx, 104, 142, 88, 180, 86, 210); // arm down
      limb(ctx, 152, 142, 178, 138, 146, 118); // hand up to the chin
      limb(ctx, 112, 205, 106, 255, 104, 300); // legs straight
      limb(ctx, 144, 205, 150, 255, 152, 300);
      charFoot(ctx, 102, 303); charFoot(ctx, 154, 303);
      charHand(ctx, 86, 210); charHand(ctx, 146, 118);
    } else if (pose === "hop-up") {
      // launch crouch: knees bent, feet still low, arms swung back
      limb(ctx, 104, 145, 80, 170, 70, 212);
      limb(ctx, 152, 145, 176, 170, 186, 212);
      limb(ctx, 112, 205, 86, 252, 104, 294);
      limb(ctx, 144, 205, 170, 252, 152, 294);
      charFoot(ctx, 102, 298); charFoot(ctx, 154, 298);
      charHand(ctx, 70, 212); charHand(ctx, 186, 212);
    } else if (pose === "hop-mid") {
      // peak tuck: knees out, feet pulled up, arms in a V overhead
      limb(ctx, 104, 142, 80, 92, 70, 46);
      limb(ctx, 152, 142, 176, 92, 186, 46);
      limb(ctx, 112, 205, 82, 232, 108, 252);
      limb(ctx, 144, 205, 174, 232, 148, 252);
      charFoot(ctx, 106, 254); charFoot(ctx, 150, 254);
      charHand(ctx, 70, 46); charHand(ctx, 186, 46);
    } else if (pose === "hop-land") {
      // deep landing bend: feet wide, arms thrown forward at chest height
      limb(ctx, 104, 148, 80, 152, 58, 150);
      limb(ctx, 152, 148, 176, 152, 198, 150);
      limb(ctx, 112, 208, 82, 256, 88, 300);
      limb(ctx, 144, 208, 174, 256, 168, 300);
      charFoot(ctx, 86, 303); charFoot(ctx, 170, 303);
      charHand(ctx, 58, 150); charHand(ctx, 198, 150);
    } else if (pose === "dead-dizzy") {
      // dazed: arms dangle straight down, legs slightly crossed
      limb(ctx, 104, 145, 100, 182, 98, 218);
      limb(ctx, 152, 145, 156, 182, 158, 218);
      limb(ctx, 112, 205, 130, 255, 140, 300);
      limb(ctx, 144, 205, 124, 255, 116, 300);
      charFoot(ctx, 140, 303); charFoot(ctx, 114, 303);
      charHand(ctx, 98, 218); charHand(ctx, 158, 218);
    } else if (pose === "dead") {
      // crumpled sprawl: everything flung wide and low
      limb(ctx, 104, 150, 70, 158, 40, 176);
      limb(ctx, 152, 150, 186, 158, 216, 176);
      limb(ctx, 112, 208, 76, 252, 44, 290);
      limb(ctx, 144, 208, 180, 252, 212, 290);
      charFoot(ctx, 42, 293); charFoot(ctx, 214, 293);
      charHand(ctx, 40, 176); charHand(ctx, 216, 176);
    } else if (pose === "fly") {
      // floating upright: legs dangle loose, arms drift down-out (wings do the work)
      limb(ctx, 108, 150, 96, 196, 92, 246);
      limb(ctx, 148, 150, 160, 196, 164, 246);
      limb(ctx, 106, 150, 88, 180, 80, 206);
      limb(ctx, 150, 150, 168, 180, 176, 206);
      charFoot(ctx, 90, 248); charFoot(ctx, 166, 248);
      charHand(ctx, 80, 206); charHand(ctx, 176, 206);
    } else {
      // idle: arms down-out, legs straight
      limb(ctx, 104, 142, 90, 178, 82, 206);
      limb(ctx, 152, 142, 166, 178, 174, 206);
      limb(ctx, 112, 205, 106, 255, 104, 300);
      limb(ctx, 144, 205, 150, 255, 152, 300);
      charFoot(ctx, 102, 303); charFoot(ctx, 154, 303);
      charHand(ctx, 82, 206); charHand(ctx, 174, 206);
    }

    // torso: a paper-filled bean drawn over the limb joins
    wobblyRoundRect(ctx, 96, 118, 64, 92, 30, J);
    ctx.fillStyle = "rgba(255,253,247,0.95)";
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 7;
    ctx.stroke();

    // head, after the torso so it overlaps the neck
    wobblyCircle(ctx, 128, 78, 44, 2);
    ctx.fillStyle = "rgba(255,253,247,0.95)";
    ctx.fill();
    ctx.stroke();

    // one flat accent detail: a little scarf at the neck
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 8;
    wobblyLine(ctx, 106, 126, 150, 126, 2); ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;

    // eyes
    if (pose === "dead" || pose === "dead-dizzy") {
      xEye(ctx, 110, 74); xEye(ctx, 146, 74);
    } else if (pose === "idle" && Math.random() < 0.18) {
      ctx.lineWidth = 5; // blink
      wobblyLine(ctx, 102, 74, 118, 74, 1); ctx.stroke();
      wobblyLine(ctx, 138, 74, 154, 74, 1); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(110, 74, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(146, 74, 5.5, 0, Math.PI * 2); ctx.fill();
    }

    // mouth
    ctx.lineWidth = 6;
    if (pose === "think" || pose === "hop-up") {
      ctx.beginPath();
      ctx.arc(128, 100, pose === "think" ? 9 : 7, 0, Math.PI * 2); // little "o"
      ctx.stroke();
    } else if (pose === "hop-mid") {
      ctx.beginPath();
      ctx.arc(128, 96, 16, 0, Math.PI); // big open grin
      ctx.closePath();
      ctx.fill();
    } else if (pose === "hop-land") {
      wobblyLine(ctx, 108, 102, 148, 102, 1.5); ctx.stroke(); // gritted teeth
    } else if (pose === "dead-dizzy") {
      ctx.beginPath(); // wavy dazed squiggle
      for (let i = 0; i <= 16; i++) {
        const x = 108 + (i / 16) * 40;
        const y = 102 + Math.sin((i / 16) * Math.PI * 3) * 4 + rand(-1, 1);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    } else if (pose === "dead") {
      wobblyLine(ctx, 112, 100, 144, 100, 1.5); ctx.stroke();
      ctx.beginPath(); // little tongue blob
      ctx.ellipse(136 + rand(-1, 1), 110, 6, 9, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(128, 88, 20, Math.PI * 0.18, Math.PI * 0.82); // smile
      ctx.stroke();
    }

    // pose extras
    if (pose === "think") {
      ctx.font = '400 56px "Patrick Hand"';
      ctx.textAlign = "center";
      ctx.fillText("?", 196 + rand(-2, 2), 56 + rand(-2, 2));
    } else if (pose === "hop-mid") {
      ctx.lineWidth = 5; // motion dashes below the feet
      wobblyLine(ctx, 106, 272, 100, 292, 1.5); ctx.stroke();
      wobblyLine(ctx, 128, 276, 128, 298, 1.5); ctx.stroke();
      wobblyLine(ctx, 150, 272, 156, 292, 1.5); ctx.stroke();
    } else if (pose === "dead") {
      ctx.lineWidth = 4; // dizzy spiral doodle above the head
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 4;
        const r = 2 + (i / 40) * 11;
        const x = 188 + r * Math.cos(a) + rand(-1, 1);
        const y = 34 + r * Math.sin(a) + rand(-1, 1);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  const charCanvas = document.createElement("canvas");
  charCanvas.width = CHAR_PX_W * TEX_SCALE;
  charCanvas.height = CHAR_PX_H * TEX_SCALE;
  const charCtx = charCanvas.getContext("2d");
  let charPose = "idle";
  drawCharCanvas(charCtx, charPose);

  const charTexture = new THREE.CanvasTexture(charCanvas);
  charTexture.colorSpace = THREE.SRGBColorSpace;
  const CHAR_STANDOFF = 0.12; // feet hover just above the keycap tops
  const CHAR_Z_OFF = -0.15; // stand toward the tile's top edge, not on the word
  const CRUISE = 1.3; // charMesh.position.y while airborne — up "in the sky"
  const charGeometry = new THREE.PlaneGeometry(0.86, 1.075);
  charGeometry.translate(0, 1.075 / 2, 0); // pivot at the feet
  const charMesh = new THREE.Mesh(
    charGeometry,
    new THREE.MeshBasicMaterial({ map: charTexture, transparent: true })
  );
  charMesh.renderOrder = 1; // only transparent mesh left — draw after keycaps
  const charTilt = { z: 0 }; // cartoon lean, composed into the billboard quat
  const charPosFor = (r, c) => {
    const s = swapTileAt(r, c); // swap tiles sit at a gapped world position
    const { x, z } = s ? s : tileAt(r, c);
    return { x, z: z + CHAR_Z_OFF };
  };
  // charGroup carries the grid position; charMesh.position.y is the jump arc.
  const startPos = charPosFor(level.start[0], level.start[1]);
  const charGroup = new THREE.Group();
  charGroup.position.set(startPos.x, CHAR_STANDOFF, startPos.z);
  charGroup.add(charMesh);
  board.add(charGroup);

  function setPose(pose) {
    charPose = pose;
    drawCharCanvas(charCtx, charPose);
    charTexture.needsUpdate = true;
  }

  // While airborne the wings beat slowly: step the flap frame on its own timer
  // and redraw the doodle. It runs independent of the idle "boil" (which pauses
  // mid-hop), so the wings keep flapping through every glide.
  let flapTimer = null, flapDir = 1;
  function startFlap() {
    stopFlap();
    wingPhase = 0;
    flapDir = 1;
    flapTimer = setInterval(() => {
      wingPhase += flapDir;
      if (wingPhase >= 3) flapDir = -1;
      else if (wingPhase <= 0) flapDir = 1;
      if (charPose === "fly") {
        drawCharCanvas(charCtx, "fly");
        charTexture.needsUpdate = true;
      }
    }, 130);
  }
  function stopFlap() {
    if (flapTimer) {
      clearInterval(flapTimer);
      flapTimer = null;
    }
  }

  // "Sketch boil": re-jitter the ink so the board looks hand-drawn and alive.
  // This used to redraw all ~16 hi-dpi (768px) tile canvases and re-upload their
  // textures to the GPU in a single tick, three times a second — a ~70ms
  // main-thread stall that dropped a frame each time and read as choppy/jagged
  // animation (measured as 40-90ms frame spikes spaced ~340ms apart on
  // HF/Safari). Two changes keep it lively without the hitch:
  //   1. Only boil while idle. During a hop / judge bob / verdict the motion
  //      already carries the life, and a stalled frame mid-motion is exactly
  //      what reads as jank — so leave those frames for the animation.
  //   2. Re-jitter only a slice of the board per tick, cycling through, so no
  //      single tick redraws+uploads more than a few textures.
  // One round-robin over every boilable surface (board tiles + the doodle + the
  // tile sides), redrawing a small fixed slice per tick so a tick never redraws
  // more than ~2 hi-dpi canvases — each tick stays well under a frame budget,
  // and the cost is spread evenly instead of bursting. ~2 of ~18 surfaces every
  // 100ms re-jitters each one roughly once a second: calm, but still alive.
  let boilCursor = 0, boilBeat = 0;
  setInterval(() => {
    if (document.hidden || state !== "idle") return;
    const surfaces = tiles.length + 2; // tiles + doodle + tile-sides
    for (let n = 0; n < 2 && surfaces; n++, boilCursor++) {
      const i = boilCursor % surfaces;
      if (i < tiles.length) {
        const t = tiles[i];
        drawTileCanvas(t.ctx, t.word);
        t.texture.needsUpdate = true;
      } else if (i === tiles.length) {
        drawCharCanvas(charCtx, charPose);
        charTexture.needsUpdate = true;
      } else {
        drawTileSideCanvas(sideCtx);
        sideTexture.needsUpdate = true;
      }
    }
    for (const s of swapTiles) { // 0-2, only once a board is cleared — cheap
      drawSwapTileCanvas(s.ctx, s.dir, s.label);
      s.texture.needsUpdate = true;
    }
    if (boilBeat++ % 4 === 0) syncAudioUI(); // mute-slash boil, no rush
  }, 100);

  // ---- sounds: a tiny Web Audio sketch-synth ----
  // Every cue is an oscillator doodle or a pinch of filtered noise — no
  // samples to load, and the bleeps match the hand-drawn look.

  // Music and sfx each carry a volume (0..1) and ride their own bus off the
  // master, so the in-game mixer can level/mute them independently. Levels
  // persist in localStorage; read them now so the buses come up at the right
  // level when the context is built.
  const AUDIO_PREF_KEY = "sq-audio";
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  function loadAudioPrefs() {
    try { return JSON.parse(localStorage.getItem(AUDIO_PREF_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveAudioPrefs() {
    try { localStorage.setItem(AUDIO_PREF_KEY, JSON.stringify({ musicVol, sfxVol })); }
    catch (e) { /* storage may be partitioned inside the HF iframe — ignore */ }
  }
  const _ap = loadAudioPrefs();
  // migrate the old on/off booleans ({music,sfx}) to volumes when present
  let musicVol = typeof _ap.musicVol === "number" ? clamp01(_ap.musicVol) : (_ap.music === false ? 0 : 1);
  let sfxVol = typeof _ap.sfxVol === "number" ? clamp01(_ap.sfxVol) : (_ap.sfx === false ? 0 : 1);
  let musicPrev = musicVol || 1; // level to restore when un-muting
  let sfxPrev = sfxVol || 1;
  // perceived loudness is ~quadratic, so square the slider before it hits gain
  const MUSIC_MAX = 0.6, SFX_MAX = 1.0; // bus level at full slider (× 0.4 master)
  const taper = (v) => v * v;
  const musicBusGain = () => MUSIC_MAX * taper(musicVol);
  const sfxBusGain = () => SFX_MAX * taper(sfxVol);

  let ac = null;
  let masterGain = null;
  let sfxGain = null; // every bleep routes here; the mixer levels it
  let musicGain = null; // the background loop routes here
  function audio() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      masterGain = ac.createGain();
      masterGain.gain.value = 0.4;
      masterGain.connect(ac.destination);
      sfxGain = ac.createGain();
      sfxGain.gain.value = sfxBusGain();
      sfxGain.connect(masterGain);
      musicGain = ac.createGain();
      musicGain.gain.value = musicBusGain();
      musicGain.connect(masterGain);
    }
    if (ac.state === "suspended") ac.resume();
    loadScratch(); // decode the pen-scratch sample on first wake-up
    return ac;
  }
  // Sounds often fire from gsap timelines (outside any user gesture), so unlock
  // the context on real gestures — these also resume after suspension, and kick
  // off the music loop the first time (browsers block audio until a gesture).
  function unlockAudio() {
    if (audio() && musicVol > 0) startMusic();
  }
  document.addEventListener("keydown", unlockAudio);
  document.addEventListener("pointerdown", unlockAudio);

  // one swept note with a fast attack and an exponential die-off
  function tone({ type = "triangle", from = 440, to = from, dur = 0.12, vol = 0.3, at = 0 }) {
    if (!audio()) return;
    const t0 = ac.currentTime + at;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  // short low-passed noise burst — paper taps and keycap thocks
  function thud({ dur = 0.05, vol = 0.4, freq = 1000, at = 0 }) {
    if (!audio()) return;
    const t0 = ac.currentTime + at;
    const len = Math.ceil(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = freq;
    const g = ac.createGain();
    g.gain.value = vol;
    src.connect(filter).connect(g).connect(sfxGain);
    src.start(t0);
  }

  // The pen-scratch cue is a real nib recording (trimmed to one stroke),
  // decoded once into a buffer the first time the audio context wakes up.
  let scratchBuf = null;
  let scratchLoading = false;
  function loadScratch() {
    if (scratchBuf || scratchLoading || !ac || !props.value.scratchAudio) return;
    scratchLoading = true;
    fetch(props.value.scratchAudio)
      .then((r) => r.arrayBuffer())
      .then((b) => ac.decodeAudioData(b))
      .then((buf) => (scratchBuf = buf))
      .catch(() => (scratchLoading = false)); // let a later wake-up retry
  }

  const sfx = {
    jump() {
      tone({ type: "triangle", from: 280, to: 640, dur: 0.14, vol: 0.3 }); // springy boing
    },
    press() {
      thud({ dur: 0.045, vol: 0.5, freq: 1300 }); // keycap thock…
      tone({ type: "sine", from: 160, to: 65, dur: 0.1, vol: 0.5 }); // …with a low bump
    },
    bonk() {
      thud({ dur: 0.06, vol: 0.35, freq: 600 });
      tone({ type: "square", from: 150, to: 70, dur: 0.16, vol: 0.16 });
    },
    pop() {
      tone({ type: "triangle", from: 900, to: 1400, dur: 0.07, vol: 0.14 }); // chip appears
    },
    soar() {
      tone({ type: "sine", from: 360, to: 820, dur: 0.34, vol: 0.16 }); // lift-off swell
      tone({ type: "triangle", from: 520, to: 1040, dur: 0.2, vol: 0.07, at: 0.06 });
    },
    flap() {
      thud({ dur: 0.07, vol: 0.1, freq: 280 }); // soft wing-beat whoosh
    },
    warp() {
      // pulled in (upward swirl), then spat back out (downward whoosh)
      tone({ type: "sine", from: 240, to: 920, dur: 0.18, vol: 0.16 });
      tone({ type: "triangle", from: 720, to: 170, dur: 0.3, vol: 0.16, at: 0.17 });
    },
    scratch(dur = 0.4) {
      if (!audio() || !scratchBuf) return; // sample still decoding → skip silently
      const src = ac.createBufferSource();
      src.buffer = scratchBuf;
      // stretch the stroke toward the word's writing time (longer words →
      // slower nib) without wild pitch shifts, plus jitter so no two are alike
      const fit = Math.min(1.12, Math.max(0.78, scratchBuf.duration / dur));
      src.playbackRate.value = fit * rand(0.97, 1.03);
      const g = ac.createGain();
      g.gain.value = 0.3; // sit under the keycap press — broadband noise reads loud
      src.connect(g).connect(sfxGain); // ride the sfx bus so the mixer levels/mutes it
      src.start();
    },
    click() {
      thud({ dur: 0.03, vol: 0.3, freq: 2500 }); // UI button tap
    },
    warn() {
      tone({ type: "square", from: 660, dur: 0.07, vol: 0.1 });
      tone({ type: "square", from: 660, dur: 0.07, vol: 0.1, at: 0.12 });
    },
    die() {
      // dizzy warble while he wobbles…
      for (let i = 0; i < 4; i++) {
        tone({ type: "sine", from: i % 2 ? 392 : 330, dur: 0.1, vol: 0.16, at: i * 0.12 });
      }
      // …then a slide-whistle drop as he slips off the board (timeline hits 0.85)
      tone({ type: "sine", from: 520, to: 90, dur: 0.62, vol: 0.26, at: 0.85 });
    },
    stamp(win) {
      thud({ dur: 0.07, vol: 0.6, freq: 500 });
      tone({ type: "sine", from: 130, to: 50, dur: 0.18, vol: 0.55 });
      if (win) {
        // quick rising arpeggio
        tone({ type: "triangle", from: 523, dur: 0.09, vol: 0.22, at: 0.15 });
        tone({ type: "triangle", from: 659, dur: 0.09, vol: 0.22, at: 0.24 });
        tone({ type: "triangle", from: 784, dur: 0.16, vol: 0.22, at: 0.33 });
      } else {
        // glum two-note shrug
        tone({ type: "triangle", from: 294, to: 277, dur: 0.16, vol: 0.18, at: 0.18 });
        tone({ type: "triangle", from: 233, to: 220, dur: 0.26, vol: 0.18, at: 0.38 });
      }
    },
  };

  // ---- background music: a looping track on the music bus ----
  // A single recorded loop (Cipher2) plays under the game via an <audio>
  // element wired into musicGain, so the mixer's music slider levels and mutes
  // it exactly like before — the bus, prefs, and gesture-unlock are unchanged.
  let musicEl = null; // the <audio> element, created on first play
  let musicSrc = null; // its MediaElementAudioSourceNode (only creatable once)
  let musicPlay = Promise.resolve(); // the last play() promise, so a quick mute
  // can wait it out instead of interrupting it (see stopMusic)

  // data.music is a "gradio_api/file=…" path. An <audio> already resolves it
  // against the document, but inside the HF iframe the file route lives under
  // the Gradio root — so prefer that root when the config exposes it, and fall
  // back to document-relative (correct on localhost and direct embeds).
  function musicUrl() {
    const root = (window.gradio_config && window.gradio_config.root) || "";
    const base = root.replace(/\/+$/, "");
    return base ? base + "/" + data.music : data.music;
  }

  function startMusic() {
    if (!audio()) return;
    if (!musicEl) {
      musicEl = new Audio(musicUrl());
      musicEl.loop = true;
      musicEl.preload = "auto";
      musicSrc = ac.createMediaElementSource(musicEl);
      musicSrc.connect(musicGain);
    }
    // play() is gesture-gated; unlockAudio drives the first call from a real tap
    musicPlay = musicEl.play() || Promise.resolve();
    musicPlay.catch(() => {});
  }
  function stopMusic() {
    if (!musicEl) return;
    // Pausing while a play() is still pending throws AbortError and can wedge
    // the element (a fast mute→unmute mid-load would then stay silent). So wait
    // for the play to settle, then pause only if we still mean to be off —
    // musicGain is already at 0, so nothing is audible in the meantime anyway.
    musicPlay.then(() => { if (musicVol === 0 && musicEl) musicEl.pause(); }).catch(() => {});
  }

  // ---- audio toggles: hand-drawn ♫ + speaker doodles in the top-right ----
  // Bake each icon to a little canvas with the wobbly-ink helpers and let the
  // boil re-jitter it, same as the keycaps. A red slash = muted.
  const ICON = 30; // logical canvas units (square)

  function makeIconCanvas(host) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = ICON * TEX_SCALE;
    host.appendChild(cv);
    return cv;
  }

  // the shared "off" mark — a wobbly accent slash struck across the icon
  function drawSlash(ctx) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 3;
    wobblyLine(ctx, 5, 7, ICON - 5, ICON - 7, 1.3);
    ctx.stroke();
  }

  function drawMusicIcon(ctx, on) {
    ctx.setTransform(TEX_SCALE, 0, 0, TEX_SCALE, 0, 0);
    ctx.clearRect(0, 0, ICON, ICON);
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.globalAlpha = on ? 1 : 0.5;
    ctx.strokeStyle = ctx.fillStyle = on ? INK : INK_SOFT;
    // two stems joined by a slanted beam — the classic two-quaver ♫
    const aStem = [13.5, 6.5], bStem = [24.5, 3.5];
    ctx.lineWidth = 2.4;
    wobblyLine(ctx, aStem[0], aStem[1], aStem[0], 21, 0.7); ctx.stroke();
    wobblyLine(ctx, bStem[0], bStem[1], bStem[0], 18, 0.7); ctx.stroke();
    ctx.lineWidth = 3.6;
    wobblyLine(ctx, aStem[0], aStem[1], bStem[0], bStem[1], 0.7); ctx.stroke();
    for (const [hx, hy] of [[10, 22], [21, 19]]) { // filled, slightly tilted note heads
      ctx.beginPath();
      ctx.ellipse(hx + rand(-0.5, 0.5), hy + rand(-0.5, 0.5), 4.2, 3.1, -0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!on) drawSlash(ctx);
    ctx.globalAlpha = 1;
  }

  function drawSpeakerIcon(ctx, on) {
    ctx.setTransform(TEX_SCALE, 0, 0, TEX_SCALE, 0, 0);
    ctx.clearRect(0, 0, ICON, ICON);
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.globalAlpha = on ? 1 : 0.5;
    // speaker body + cone as one wobbly outline
    const pts = [[6, 12], [6, 18], [10, 18], [16, 24], [16, 6], [10, 12]];
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const jx = x + rand(-0.5, 0.5), jy = y + rand(-0.5, 0.5);
      i ? ctx.lineTo(jx, jy) : ctx.moveTo(jx, jy);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(255,253,247,0.9)";
    ctx.fill();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = on ? INK : INK_SOFT;
    ctx.stroke();
    if (on) { // sound waves only when the sfx are on
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(18, 15, 3.5, -0.9, 0.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(18, 15, 6.5, -0.85, 0.85); ctx.stroke();
    }
    if (!on) drawSlash(ctx);
    ctx.globalAlpha = 1;
  }

  const audioCluster = element.querySelector(".sq-audio");
  const musicBtn = element.querySelector(".sq-music-btn");
  const sfxBtn = element.querySelector(".sq-sfx-btn");
  const popEl = element.querySelector(".sq-audio-pop");
  const volMusicBtn = element.querySelector(".sq-vol-music");
  const volSfxBtn = element.querySelector(".sq-vol-sfx");
  const musicIconCtx = makeIconCanvas(musicBtn).getContext("2d");
  const sfxIconCtx = makeIconCanvas(sfxBtn).getContext("2d");
  const volMusicCtx = makeIconCanvas(volMusicBtn).getContext("2d");
  const volSfxCtx = makeIconCanvas(volSfxBtn).getContext("2d");

  // ---- volume sliders: a wobbly ink rule with a filled level + draggable nib ----
  const SLIDER_W = 120, SLIDER_H = 26, SLIDER_PAD = 11;
  function drawSlider(ctx, val) {
    ctx.setTransform(TEX_SCALE, 0, 0, TEX_SCALE, 0, 0);
    ctx.clearRect(0, 0, SLIDER_W, SLIDER_H);
    ctx.lineJoin = ctx.lineCap = "round";
    const y = SLIDER_H / 2, x0 = SLIDER_PAD, x1 = SLIDER_W - SLIDER_PAD;
    const nx = x0 + clamp01(val) * (x1 - x0);
    ctx.globalAlpha = 0.5; ctx.strokeStyle = INK_SOFT; ctx.lineWidth = 3; // faint full track
    wobblyLine(ctx, x0, y, x1, y, 1.0); ctx.stroke();
    ctx.globalAlpha = 1;
    if (nx > x0 + 0.5) { ctx.strokeStyle = INK; ctx.lineWidth = 4.5; wobblyLine(ctx, x0, y, nx, y, 0.9); ctx.stroke(); } // inked level
    wobblyCircle(ctx, nx, y, 6.5, 1.1); // the nib
    ctx.fillStyle = "rgba(255,253,247,0.95)"; ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 3.5; ctx.stroke();
  }
  function setupSlider(el, ch) {
    const cv = document.createElement("canvas");
    cv.width = SLIDER_W * TEX_SCALE; cv.height = SLIDER_H * TEX_SCALE;
    el.appendChild(cv);
    let dragging = false;
    // .sq-slider is exactly SLIDER_W css px, so clientX maps 1:1 to logical units
    const valAt = (e) => clamp01((e.clientX - el.getBoundingClientRect().left - SLIDER_PAD) / (SLIDER_W - 2 * SLIDER_PAD));
    const apply = (e) => (ch === "music" ? setMusicVol(valAt(e), true) : setSfxVol(valAt(e), true));
    el.addEventListener("pointerdown", (e) => { dragging = true; el.setPointerCapture(e.pointerId); audio(); apply(e); });
    el.addEventListener("pointermove", (e) => { if (dragging) apply(e); });
    el.addEventListener("pointerup", () => { if (dragging) { dragging = false; saveAudioPrefs(); } });
    el.addEventListener("pointercancel", () => (dragging = false));
    return cv.getContext("2d");
  }
  const musicSliderCtx = setupSlider(element.querySelector('.sq-slider[data-ch="music"]'), "music");
  const sfxSliderCtx = setupSlider(element.querySelector('.sq-slider[data-ch="sfx"]'), "sfx");

  // redraw the whole audio UI: bar icons always (slash when a channel is at 0),
  // popover icons + sliders only while it's open. Re-jittered by the boil.
  function syncAudioUI() {
    if (!musicIconCtx) return;
    const mOn = musicVol > 0, sOn = sfxVol > 0;
    drawMusicIcon(musicIconCtx, mOn);
    drawSpeakerIcon(sfxIconCtx, sOn);
    if (popOpen) {
      drawMusicIcon(volMusicCtx, mOn);
      drawSpeakerIcon(volSfxCtx, sOn);
      drawSlider(musicSliderCtx, musicVol);
      drawSlider(sfxSliderCtx, sfxVol);
      volMusicBtn.setAttribute("aria-pressed", String(!mOn));
      volSfxBtn.setAttribute("aria-pressed", String(!sOn));
    }
  }

  // ---- volume + mute state ----
  function setMusicVol(v, live) {
    musicVol = clamp01(v);
    if (musicVol > 0) musicPrev = musicVol;
    audio();
    // snap the gain while dragging (responsive), ramp it on mute/unmute (smooth)
    if (musicGain) { const g = musicBusGain(); live ? (musicGain.gain.value = g) : gsap.to(musicGain.gain, { value: g, duration: 0.18, overwrite: true }); }
    musicVol > 0 ? startMusic() : stopMusic();
    syncAudioUI();
  }
  function setSfxVol(v, live) {
    sfxVol = clamp01(v);
    if (sfxVol > 0) sfxPrev = sfxVol;
    audio();
    if (sfxGain) { const g = sfxBusGain(); live ? (sfxGain.gain.value = g) : gsap.to(sfxGain.gain, { value: g, duration: 0.18, overwrite: true }); }
    syncAudioUI();
  }
  function toggleMute(ch) {
    if (ch === "music") musicVol > 0 ? setMusicVol(0, false) : setMusicVol(musicPrev || 1, false);
    else sfxVol > 0 ? setSfxVol(0, false) : setSfxVol(sfxPrev || 1, false);
    saveAudioPrefs();
  }

  // ---- the mixer popover ----
  let popOpen = false;
  function openPop() {
    popOpen = true;
    // Kill any in-flight close so its onComplete can't re-hide us mid-reopen —
    // a quick close→reopen otherwise leaves popOpen=true but display:none, and
    // the next tap (on a now-invisible slider) falls through to the board and
    // the outside-tap handler closes the mixer.
    gsap.killTweensOf(popEl);
    popEl.classList.remove("sq-hidden");
    musicBtn.setAttribute("aria-expanded", "true");
    sfxBtn.setAttribute("aria-expanded", "true");
    syncAudioUI();
    gsap.fromTo(popEl,
      { autoAlpha: 0, y: -6, scale: 0.96, rotation: -3 },
      { autoAlpha: 1, y: 0, scale: 1, rotation: -1, duration: 0.22, ease: "back.out(1.7)" });
  }
  function closePop() {
    if (!popOpen) return;
    popOpen = false;
    musicBtn.setAttribute("aria-expanded", "false");
    sfxBtn.setAttribute("aria-expanded", "false");
    gsap.to(popEl, {
      autoAlpha: 0, y: -6, duration: 0.15,
      onComplete: () => {
        if (popOpen) return; // reopened during the fade — leave it visible
        popEl.classList.add("sq-hidden");
        gsap.set(popEl, { clearProps: "opacity,transform,visibility" });
      },
    });
  }
  function togglePop() { popOpen ? closePop() : openPop(); }

  // the bar icons now open the mixer; muting + levels live inside it
  const onBarTap = () => { audio(); sfx.click(); togglePop(); };
  musicBtn.addEventListener("click", onBarTap);
  sfxBtn.addEventListener("click", onBarTap);
  volMusicBtn.addEventListener("click", () => { toggleMute("music"); sfx.click(); });
  volSfxBtn.addEventListener("click", () => { const was = sfxVol > 0; toggleMute("sfx"); if (!was) sfx.click(); });

  // Stop pointer events that start inside the mixer from reaching the
  // outside-tap handler at all. The .contains() guard below should already
  // spare them, but under Safari/WebKit a slider's pointer capture can retarget
  // the event so .contains() reads false and the drag dismisses the mixer —
  // exactly the "click a slider and it closes" bug. Halting here is airtight.
  popEl.addEventListener("pointerdown", (e) => e.stopPropagation());

  // dismiss on an outside tap or Escape
  document.addEventListener("pointerdown", (e) => { if (popOpen && !audioCluster.contains(e.target)) closePop(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });

  syncAudioUI();

  // ---- game state ----

  const chipsEl = element.querySelector(".sq-chips");
  const hintEl = element.querySelector(".sq-hint");

  // Touch devices have no keyboard, so they get swipe controls — say so.
  const HOP_HINT = window.matchMedia("(pointer: coarse)").matches
    ? "swipe to hop"
    : "arrow keys / WASD to hop";
  hintEl.textContent = HOP_HINT;

  let state = "idle"; // idle | hopping | judging | verdict | dead
  let pos = [...level.start];
  let words = []; // appended (non-structural) words
  let used = 0; // hops spent
  // airborne hops remaining after a wings launch: 3 → two free glides, then the
  // third descends and lands for real. 0 means grounded.
  let flightLeft = 0;

  // Cancel any flight in progress (board change / death / fresh attempt).
  function resetFlight() {
    flightLeft = 0;
    stopFlap();
  }

  // After a hop settles, replay one buffered input so mashing feels responsive.
  function pumpBuffered() {
    if (buffered) {
      const dir = buffered;
      buffered = null;
      tryMove(dir);
    }
  }

  // Each sentence word is handwritten in: the ink reveals left→right, like the
  // doodle is writing the sentence out.
  function addChip(word) {
    const chip = document.createElement("span");
    chip.className = "sq-chip";
    chip.style.setProperty("--tilt", `${rand(-2, 2).toFixed(1)}deg`);
    const text = document.createElement("span");
    text.className = "sq-chip-text";
    text.textContent = word;
    chip.appendChild(text);
    chipsEl.appendChild(chip);
    const dur = 0.16 + word.length * 0.06; // writing pace scales with word length
    sfx.scratch(dur); // pen scratches for as long as the word takes to write
    // Reveal left→right by sweeping the right inset 100%→0. Two Safari traps to
    // avoid (this runs in HF's iframe under WebKit): Safari CLAMPS negative
    // clip-path insets to 0, and it won't repaint a clip-path that's later
    // *removed* (clearProps) until a manual reflow. The old negative insets +
    // clearProps therefore left the just-written word shaved off on the right
    // until you inspect-element. So: end on a plain inset(0) — no negatives, no
    // removal — and pad .sq-chip-text (cancelled in layout) so inset(0) wraps
    // every glyph, slant and descender with room to spare.
    gsap.fromTo(
      text,
      { clipPath: "inset(0 100% 0 0)" },
      { clipPath: "inset(0 0% 0 0)", duration: dur, ease: "none" }
    );
  }

  function bonk() {
    sfx.bonk();
    gsap.timeline()
      .to(charTilt, { z: -0.13, duration: 0.05 })
      .to(charTilt, { z: 0.13, duration: 0.09, repeat: 2, yoyo: true })
      .to(charTilt, { z: 0, duration: 0.05 });
  }

  // Airborne glide: the doodle floats tile-to-tile at cruise altitude. The two
  // post-launch hops bob gently and stay up; the third (flightLeft === 1)
  // descends to the board so land() can resolve the tile it comes down onto.
  function glideTo(r, c) {
    const { x, z } = charPosFor(r, c);
    const descending = flightLeft === 1;
    sfx.flap();
    const tl = gsap.timeline({ onComplete: () => land(r, c) });
    tl.to(charGroup.position, { x, z, duration: descending ? 0.4 : 0.34, ease: "power1.inOut" }, 0);
    if (descending) {
      tl.to(charMesh.position, { y: 0, duration: 0.4, ease: "power2.in" }, 0) // come down from the sky
        .to(charMesh.scale, { x: 1.1, y: 0.86, duration: 0.06 }, 0.4) // touch-down squash
        .to(charMesh.scale, { x: 1, y: 1, duration: 0.12, ease: "back.out(3)" }, 0.46);
    } else {
      tl.to(charMesh.position, { y: CRUISE + 0.14, duration: 0.17, ease: "sine.out" }, 0) // gentle float-bob
        .to(charMesh.position, { y: CRUISE, duration: 0.17, ease: "sine.in" }, 0.17);
    }
  }

  // Land on a wings tile → put on wings and lift off. The next three hops are
  // airborne (see glideTo); play resumes once the rise settles.
  function takeOff() {
    flightLeft = 3;
    state = "hopping";
    setPose("fly");
    startFlap();
    sfx.soar();
    gsap.timeline({ onComplete: () => { state = "idle"; pumpBuffered(); } })
      .to(charMesh.position, { y: CRUISE, duration: 0.42, ease: "power2.out" }, 0)
      .to(charMesh.scale, { x: 1.06, y: 1.06, duration: 0.16, ease: "sine.out" }, 0)
      .to(charMesh.scale, { x: 1, y: 1, duration: 0.22, ease: "sine.inOut" }, 0.16);
  }

  function hopTo(r, c) {
    state = "hopping";
    if (flightLeft > 0) return glideTo(r, c); // airborne: glide, don't ground-hop
    const { x, z } = charPosFor(r, c);
    gsap.timeline({ onComplete: () => land(r, c) })
      .add(() => setPose("hop-up"))
      .to(charMesh.scale, { x: 1.18, y: 0.78, duration: 0.08, ease: "power1.in" }) // anticipation squash (feet pivot)
      .to(charMesh.scale, { x: 0.94, y: 1.12, duration: 0.09 })
      .add(() => sfx.jump(), 0.08) // boing as the feet leave the key
      .to(charGroup.position, { x, z, duration: 0.24, ease: "power3.out" }, 0.08) // fast-out horizontal
      .to(charMesh.position, { y: 0.85, duration: 0.13, ease: "power2.out" }, 0.08) // arc up
      .add(() => setPose("hop-mid"), 0.14)
      .to(charMesh.position, { y: 0, duration: 0.12, ease: "power2.in" }, 0.21) // arc down
      .add(() => setPose("hop-land"), 0.30)
      .to(charMesh.scale, { x: 1.12, y: 0.84, duration: 0.06 }, 0.33) // landing squash
      .to(charMesh.scale, { x: 1, y: 1, duration: 0.11, ease: "back.out(3)" }, 0.39);
  }

  function land(r, c) {
    pos = [r, c];

    // a swap tile hops you to another board — costs no budget, adds no word.
    const swap = swapTileAt(r, c);
    if (swap) {
      resetFlight();
      pressTile(swap);
      return loadLevel(swap.targetId);
    }

    // airborne: the two post-launch hops glide free — no keypress, no word, no
    // budget. Only the third (flightLeft === 1) descends to land for real.
    if (flightLeft > 1) {
      flightLeft -= 1;
      state = "idle";
      return pumpBuffered();
    }
    if (flightLeft === 1) {
      flightLeft = 0;
      stopFlap(); // wings fold as the doodle touches down; land for real below
    }

    used += 1;

    // landed keycap press
    const t = tile(r, c);
    pressTile(t);
    const word = t.word;

    // the hop that EXCEEDS the budget kills — even onto "⏎". The fatal
    // word never makes it into the sentence: no chip.
    if (used > level.budget) return die();

    hud.update(used);
    setPose("idle");

    // a wings tile launches flight: the doodle puts on wings and lifts off.
    if (word === "wings") return takeOff();

    if (appendsWord(word)) {
      words.push(word);
      addChip(word);
    }

    if (word === "⏎") return submit();
    if (word === "portal") return portalWarp(r, c); // teleport, then settle
    settleIdle();
  }

  // Tail of a normal landing: warn on the last hop, go idle, and drain a
  // buffered move. Shared by land() and the portal warp's arrival.
  function settleIdle() {
    if (used === level.budget) {
      hud.warnFull();
      hintEl.textContent = "last hop! one more and you're out…";
      gsap.to(hintEl, { opacity: 1, duration: 0.3 });
    }
    state = "idle";
    pumpBuffered();
  }

  // Hop onto a portal and the doodle is whisked to the next portal clockwise:
  // it shrinks and screws down INTO the source spiral, vanishes, then expands
  // and unwinds back OUT of the destination one. The teleport adds no word and
  // (the landing hop is already spent) no extra budget.
  function portalWarp(r, c) {
    const dest = portalDest[r + "," + c];
    if (!dest) return settleIdle(); // a lone portal links nowhere — just stand
    const [dr, dc] = dest;
    const d = charPosFor(dr, dc);
    const into = tile(r, c).spinner;
    const outOf = tile(dr, dc).spinner;
    state = "hopping"; // block input through the warp (one move may buffer)
    sfx.warp();
    setPose("hop-mid");
    if (into) // the source spiral flares as it swallows him
      gsap.fromTo(into.scale, { x: 1, z: 1 },
        { x: 1.3, z: 1.3, duration: 0.3, ease: "power2.in", yoyo: true, repeat: 1 });
    gsap.timeline({ onComplete: () => { pos = [dr, dc]; setPose("idle"); settleIdle(); } })
      // screw down into the source spiral and shrink away
      .to(charMesh.scale, { x: 0, y: 0, duration: 0.32, ease: "power2.in" }, 0)
      .to(charTilt, { z: Math.PI * 2.5, duration: 0.32, ease: "power2.in" }, 0)
      .to(charMesh.position, { y: -0.14, duration: 0.32, ease: "power2.in" }, 0)
      // reappear at the destination, wound up the other way
      .add(() => {
        charGroup.position.set(d.x, CHAR_STANDOFF, d.z);
        charMesh.position.y = 0;
        charTilt.z = -Math.PI * 2.5;
        if (outOf) // the destination spiral spits him back out
          gsap.fromTo(outOf.scale, { x: 1.35, z: 1.35 },
            { x: 1, z: 1, duration: 0.45, ease: "power2.out" });
      })
      // expand and unwind back out of the destination spiral
      .to(charMesh.scale, { x: 1, y: 1, duration: 0.42, ease: "back.out(1.7)" })
      .to(charTilt, { z: 0, duration: 0.46, ease: "power3.out" }, "<");
  }

  // Overflow death: a dizzy wobble, then the doodle crumples and slides
  // clean off the bottom of the board.
  function die() {
    state = "dead";
    buffered = null;
    resetFlight();
    gsap.killTweensOf([charMesh.scale, charMesh.position, charGroup.position, charTilt]);
    hud.overflow();
    hintEl.textContent = "";
    setPose("dead-dizzy");
    sfx.die();
    gsap.timeline({ onComplete: showDeathCard })
      .to(charTilt, { z: 0.18, duration: 0.11, yoyo: true, repeat: 3 }) // dizzy wobble
      .add(() => setPose("dead"), 0.5)
      .to(charMesh.scale, { y: 0.6, x: 1.25, duration: 0.15, ease: "power2.in" }, 0.5) // crumple (feet pivot)
      .to(charMesh.position, { y: "-=3", duration: 0.6, ease: "power1.in" }, 0.85) // slides off the board
      .to(charTilt, { z: Math.PI * 0.85, duration: 0.6, ease: "power1.in" }, 0.85)
      .to(charMesh.material, { opacity: 0, duration: 0.25 }, 1.2);
  }

  // ---- judging + verdict ----

  const overlayEl = element.querySelector(".sq-overlay");
  const cardEl = element.querySelector(".sq-card");
  const sentenceEl = element.querySelector(".sq-card-sentence");
  const barsEl = element.querySelector(".sq-bars");
  const stampEl = element.querySelector(".sq-stamp");
  const retryBtn = element.querySelector(".sq-retry");
  const againBtn = element.querySelector(".sq-again");

  async function submit() {
    state = "judging";
    buffered = null;
    setPose("think");
    hintEl.textContent = "the judge is reading…";
    gsap.to(hintEl, { opacity: 1, duration: 0.3 });
    const bob = gsap.to(charMesh.position, {
      y: 0.12, duration: 0.55, repeat: -1, yoyo: true, ease: "sine.inOut",
    });
    const slowTimer = setTimeout(() => {
      hintEl.textContent = "the tiny model is stretching its parameters…";
    }, 4000);

    let res;
    try {
      res = await server.judge({ words, targets: remainingTargets(), level_id: level.id });
    } catch (err) {
      res = { ok: false, error: String(err) };
    }
    clearTimeout(slowTimer);
    bob.kill();
    gsap.to(charMesh.position, { y: 0, duration: 0.2 });

    if (!res || !res.ok) return judgeFailed(res && res.error);
    showVerdict(res);
  }

  function openCard() {
    overlayEl.classList.remove("sq-hidden");
    gsap.fromTo(overlayEl, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 });
    gsap.fromTo(
      cardEl,
      { y: 36, rotation: -4, scale: 0.92, autoAlpha: 0 },
      { y: 0, rotation: -1, scale: 1, autoAlpha: 1, duration: 0.4, ease: "back.out(1.6)" }
    );
  }

  function judgeFailed(error) {
    console.warn("judge failed:", error);
    sentenceEl.textContent = "the judge dozed off…";
    barsEl.innerHTML = "";
    stampEl.style.opacity = 0;
    retryBtn.classList.remove("sq-hidden");
    againBtn.classList.add("sq-hidden");
    retryBtn.onclick = () => {
      overlayEl.classList.add("sq-hidden");
      submit();
    };
    openCard();
  }

  // Death card: same overlay, but there's no sentence to judge — the
  // doodle ran out of hops.
  function showDeathCard() {
    sentenceEl.textContent = "out of hops…";
    barsEl.innerHTML = "";
    stampEl.textContent = "context window exceeded";
    stampEl.classList.remove("sq-win");
    stampEl.style.opacity = 0;
    retryBtn.classList.add("sq-hidden");
    againBtn.classList.remove("sq-hidden");
    openCard();
    gsap.fromTo(
      stampEl,
      { opacity: 0, scale: 3, rotation: 24 },
      {
        opacity: 1, scale: 1, rotation: 8, duration: 0.3, ease: "power3.in", delay: 0.45,
        onComplete: () => sfx.stamp(false),
      }
    );
  }

  function showVerdict(res) {
    state = "verdict";
    setPose(res.verdict === "win" ? "hop-mid" : "idle");
    hintEl.textContent = "";

    sentenceEl.innerHTML = "";
    const quote = document.createElement("div");
    quote.textContent = `“${res.sentence}”`;
    sentenceEl.appendChild(quote);

    // probability bars, sorted by prob so the verdict reads top-down
    barsEl.innerHTML = "";
    const entries = Object.entries(res.probs).sort((a, b) => b[1] - a[1]);
    const fills = [];
    for (const [label, p] of entries) {
      const row = document.createElement("div");
      row.className = "sq-bar-row" + (checkedOnThisLevel().has(label) ? "" : " sq-bar-target");
      const name = document.createElement("span");
      name.className = "sq-bar-label";
      name.textContent = label;
      const track = document.createElement("div");
      track.className = "sq-bar-track";
      const fill = document.createElement("div");
      fill.className = "sq-bar-fill";
      track.appendChild(fill);
      const pct = document.createElement("span");
      pct.className = "sq-bar-pct";
      pct.textContent = "0%";
      row.append(name, track, pct);
      barsEl.appendChild(row);
      fills.push({ fill, pct, p });
    }

    retryBtn.classList.add("sq-hidden");
    againBtn.classList.remove("sq-hidden");
    // a repeat of an already-checked emotion isn't a win — say so on the stamp
    stampEl.textContent =
      res.verdict === "win" ? `${res.winner}!`
      : checkedOnThisLevel().has(res.winner) ? `${res.winner}, again.`
      : `${res.winner}.`;
    stampEl.classList.toggle("sq-win", res.verdict === "win");
    stampEl.style.opacity = 0;

    openCard();

    const tl = gsap.timeline({ delay: 0.35 });
    fills.forEach(({ fill, pct, p }, i) => {
      const counter = { v: 0 };
      tl.to(fill, { width: `${(p * 100).toFixed(1)}%`, duration: 0.7, ease: "power2.out" }, 0.15 * i);
      tl.to(counter, {
        v: p * 100, duration: 0.7, ease: "power2.out",
        onUpdate: () => (pct.textContent = `${counter.v.toFixed(0)}%`),
      }, 0.15 * i);
    });
    tl.fromTo(
      stampEl,
      { opacity: 0, scale: 3, rotation: 24 },
      {
        opacity: 1, scale: 1, rotation: 8, duration: 0.3, ease: "power3.in",
        onComplete: () => {
          sfx.stamp(res.verdict === "win");
          if (res.verdict === "win") checkOff(res.winner);
        },
      },
      ">-0.1"
    ).to(cardEl, { x: "+=5", yoyo: true, repeat: 3, duration: 0.04 }, ">"); // thump
  }

  // ---- reset ----

  // Clear the sentence/hops/HUD back to a fresh attempt on the current board.
  function resetGameState() {
    words = [];
    used = 0;
    pos = [...level.start];
    buffered = null;
    resetFlight();
    [...chipsEl.querySelectorAll(".sq-chip")].forEach((c) => c.remove());
    hud.reset();
    hintEl.textContent = remainingTargets().length
      ? HOP_HINT
      : "all targets collected! free hopping";
    gsap.to(hintEl, { opacity: 1, duration: 0.4 });
  }

  // Poof the doodle back onto its start tile (used by "hop again").
  function poofToStart() {
    const home = charPosFor(level.start[0], level.start[1]);
    gsap.timeline({ onComplete: () => (state = "idle") })
      .to(charMesh.scale, { x: 0, y: 0, duration: 0.18, ease: "power2.in" })
      .add(() => {
        charGroup.position.set(home.x, CHAR_STANDOFF, home.z);
        charMesh.position.y = 0;
        charTilt.z = 0;
        charMesh.material.opacity = 1;
        setPose("idle");
      })
      .add(() => sfx.pop()) // poof back in
      .to(charMesh.scale, { x: 1, y: 1, duration: 0.28, ease: "back.out(2.5)" });
  }

  // Board intro / progression: transport the doodle straight onto the new
  // board's start tile (the centre on most boards), then rain the other keycaps
  // down from the sky around it, staggered by distance — the level assembles
  // itself around the doodle, then play begins.
  const DROP_H = 4.2; // how high above the board the keycaps start
  function dropInBoard() {
    const [sr, sc] = level.start;
    const rest = -TILE_DEPTH / 2;

    // the doodle materialises on the anchor tile (which stays put)
    const home = charPosFor(sr, sc);
    charMesh.scale.x = charMesh.scale.y = 0;
    charGroup.position.set(home.x, CHAR_STANDOFF, home.z);
    charMesh.position.y = 0;
    charTilt.z = 0;
    charMesh.material.opacity = 1;
    setPose("idle");

    // every other keycap falls in around it, nearest first
    let last = 0.6;
    for (const t of tiles) {
      if (t.row === sr && t.col === sc) continue; // anchor stays put
      const dist = Math.hypot(t.row - sr, t.col - sc);
      const delay = 0.12 + dist * 0.075;
      last = Math.max(last, delay + 0.55);
      gsap.fromTo(
        t.mesh.position,
        { y: rest + DROP_H },
        {
          y: rest, duration: 0.55, ease: "bounce.out", delay,
          onComplete: () => thud({ dur: 0.035, vol: 0.12, freq: 1100 }), // soft patter
        }
      );
    }

    // pop the doodle in a beat later, as if it arrived through the swap tile
    gsap.timeline({ delay: 0.12 })
      .add(() => sfx.pop())
      .to(charMesh.scale, { x: 1, y: 1, duration: 0.3, ease: "back.out(2.5)" });

    gsap.delayedCall(last, () => (state = "idle")); // play begins once it settles
  }

  function reset() {
    gsap.to(overlayEl, {
      autoAlpha: 0, duration: 0.25,
      onComplete: () => {
        overlayEl.classList.add("sq-hidden");
        overlayEl.style.opacity = "";
      },
    });
    resetGameState();
    poofToStart();
  }

  againBtn.addEventListener("click", reset);
  againBtn.addEventListener("click", () => sfx.click());
  retryBtn.addEventListener("click", () => sfx.click());

  // ---- input ----

  const DIRS = {
    arrowup: [-1, 0], arrowdown: [1, 0], arrowleft: [0, -1], arrowright: [0, 1],
    w: [-1, 0], s: [1, 0], a: [0, -1], d: [0, 1],
  };

  let buffered = null; // 1-deep move buffer so mashing feels responsive

  function tryMove(dir) {
    if (used === 0) gsap.to(hintEl, { opacity: 0.35, duration: 0.6 });
    const nr = pos[0] + dir[0];
    const nc = pos[1] + dir[1];
    if (swapTileAt(nr, nc)) return hopTo(nr, nc); // hop off the edge onto a swap tile
    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return bonk();
    hopTo(nr, nc);
  }

  // Shared by keyboard and swipe: hop now, or buffer one move mid-hop.
  function handleDir(dir) {
    if (state === "hopping" && !buffered) {
      buffered = dir;
      return;
    }
    if (state !== "idle") return;
    tryMove(dir);
  }

  document.addEventListener("keydown", (e) => {
    const dir = DIRS[e.key.toLowerCase()];
    if (!dir || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    handleDir(dir);
  });

  // Touch: a swipe maps 1:1 to the arrow keys. The board is screen-aligned
  // (row− is up/away, col+ is right), so the gesture's dominant axis picks the
  // same DIRS vector the keyboard uses. One swipe = one hop, decided on release.
  // `touch-action: none` on .sq-root suppresses scroll/zoom, so no preventDefault
  // bookkeeping is needed here. Mouse stays on the keyboard (no accidental hops).
  const SWIPE_MIN = 28; // px; a shorter drag is a tap, ignored
  let swStart = null;
  stage.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    swStart = { x: e.clientX, y: e.clientY };
  });
  stage.addEventListener("pointerup", (e) => {
    if (!swStart) return;
    const dx = e.clientX - swStart.x;
    const dy = e.clientY - swStart.y;
    swStart = null;
    if (Math.hypot(dx, dy) < SWIPE_MIN) return;
    const dir = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? DIRS.d : DIRS.a) // right / left
      : (dy > 0 ? DIRS.s : DIRS.w); // down / up
    handleDir(dir);
  });
  stage.addEventListener("pointercancel", () => (swStart = null));

  // ---- camera framing ----
  let viewUnits = 7.0; // world units visible vertically; sized to the board by reframe()
  function reframe() {
    // active swap tiles widen the board by one gapped column on each side they're on
    const horiz = (COLS - 1) * SPACING + TILE_SIZE + swapTiles.length * (SPACING + SWAP_GAP);
    const vert = (ROWS - 1) * SPACING + TILE_SIZE;
    viewUnits = Math.max(horiz, vert) + 1.2; // a little margin around the board
    resize();
  }
  function resize() {
    const w = stage.clientWidth || 1;
    const h = stage.clientHeight || 1;
    const aspect = w / h;
    // Short viewports (landscape phones) are wide but only ~400px tall, so the
    // top chrome (HUD + sentence) and bottom hint would clip the board. Zoom out
    // a touch more and aim higher, dropping the board into the clear middle band.
    const short = h <= 540;
    // fov stays 32°; dolly the camera so the board fits either way.
    // Portrait phones: trim the side margin so the board fills the narrow width
    // instead of floating small in the middle (landscape keeps the wider margin
    // and the zoom-out floor below, so its short height doesn't clip the board).
    const narrow = w <= 560 && !short;
    const hMargin = narrow ? 1.7 : 0.2;
    // board-sized base, narrow-window fit, plus the landscape-phone zoom-out floor
    const need = Math.max(viewUnits, (viewUnits - hMargin) / aspect, short ? 9.4 : 0);
    camera.position.z = need / 2 / Math.tan(THREE.MathUtils.degToRad(32 / 2));
    camera.aspect = aspect;
    camera.lookAt(0, short ? 0.55 : 0.25, 0);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  new ResizeObserver(resize).observe(stage);

  // The targets checklist wraps to several lines on phones, so the HUD height is
  // variable. Publish it as --hud-h; the phone CSS drops the prompt strip and the
  // board below it so the wrapped checklist never overlaps the keys. Re-measures
  // on board switch (8 vs 10 targets) and web-font load via the observer.
  const hudEl = element.querySelector(".sq-hud");
  const syncHud = () => root.style.setProperty("--hud-h", hudEl.offsetHeight + "px");
  new ResizeObserver(syncHud).observe(hudEl);
  syncHud();

  // The board never moves, so the billboard's parent correction is constant.
  const _bbParentInv = new THREE.Quaternion();
  charGroup.getWorldQuaternion(_bbParentInv).invert();
  const _bbSpin = new THREE.Quaternion();
  const _Z = new THREE.Vector3(0, 0, 1);

  renderer.setAnimationLoop((time) => {
    // billboard the doodle, then lean it by charTilt.z (bonks, deaths…)
    charMesh.quaternion
      .copy(_bbParentInv)
      .multiply(camera.quaternion)
      .multiply(_bbSpin.setFromAxisAngle(_Z, charTilt.z));
    // every portal spiral turns lazily in place — the swirl is this spin, not a
    // texture redraw, so it costs nothing on the main thread.
    const spin = (time || 0) * 0.0016; // ~one turn every 4s
    for (const s of portalSpinners) s.rotation.y = spin;
    renderer.render(scene, camera);
  });

  // Swap the active board: rebuild tiles + checklist + swap tiles, reframe, poof in.
  function loadLevel(id) {
    resetFlight();
    gsap.killTweensOf([charMesh.scale, charMesh.position, charGroup.position, charTilt, charMesh.material]);
    overlayEl.classList.add("sq-hidden");
    overlayEl.style.opacity = "";
    level = LEVELS[id];
    state = "hopping"; // block input until the poof lands (then -> idle)
    buildTiles();
    buildTargets();
    buildSwapTiles();
    resetGameState();
    reframe();
    dropInBoard();
  }

  loadLevel(data.home);
  root.dataset.state = "ready";
})();
