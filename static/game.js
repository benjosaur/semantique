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

  // A grid cell appends its word unless it's structural (start / blank / =).
  const appendsWord = (w) => w && w !== "start" && w !== "=";

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
      const check = document.createElement("span");
      check.className = "sq-target-check";
      check.textContent = "✓";
      item.appendChild(check);
      if (checked.has(label)) {
        item.classList.add("sq-checked");
        check.style.opacity = 1;
      }
      targetListEl.appendChild(item);
      targetItems[label] = item;
    }
    element.querySelector(".sq-ctx-cap").textContent = level.budget;
  }

  function checkOff(label) {
    checkedOnThisLevel().add(label);
    const item = targetItems[label];
    item.classList.add("sq-checked");
    gsap.fromTo(
      item.querySelector(".sq-target-check"),
      { opacity: 0, scale: 2.6, rotation: -24 },
      { opacity: 1, scale: 1, rotation: -8, duration: 0.3, ease: "power3.in" }
    );
    updateNav(); // first check on the home board reveals the "next" arrow
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

  const TILE_PX = 384; // logical texture units per tile
  // Canvas textures are baked at devicePixelRatio so words and ink lines stay
  // crisp on hidpi screens (all drawing keeps using logical coordinates).
  const TEX_SCALE = Math.min(window.devicePixelRatio || 1, 2);

  function drawTileCanvas(ctx, word) {
    ctx.setTransform(TEX_SCALE, 0, 0, TEX_SCALE, 0, 0);
    const special = word === "start" || word === "=";
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
    ctx.setLineDash(special ? [16, 13] : []);
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.setLineDash([]);
    wobblyRoundRect(ctx, inset, inset, span, span, cr, 4.5);
    ctx.strokeStyle = special ? "rgba(90,86,76,0.35)" : "rgba(28,27,24,0.35)";
    ctx.lineWidth = 4;
    ctx.stroke();

    // the word — start and empty tiles are blank squares, so they stay wordless
    const blank = !word || word === "start";
    if (!blank) {
      ctx.fillStyle = special ? INK_SOFT : INK;
      let size = word.length > 6 ? 64 : 76;
      ctx.font = `400 ${size}px "Patrick Hand"`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(word, TILE_PX / 2 + rand(-2, 2), TILE_PX / 2 + rand(-1, 3));
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

  // ---- three.js paper scene ----
  const scene = new THREE.Scene(); // transparent: CSS paper + ruled lines show through

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, -0.9, 11.5); // slightly below-front: keycap sides read
  camera.lookAt(0, 0.25, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

  let tiles = []; // { mesh, ctx, texture, word, row, col }
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // (Re)build the keycaps for the active board, disposing the previous set.
  function buildTiles() {
    for (const t of tiles) {
      board.remove(t.mesh);
      t.texture.dispose();
      t.mesh.material[0].dispose(); // per-tile cap material (side is shared)
    }
    tiles = [];
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
        tiles.push({ mesh, ctx, texture, word, row: r, col: c });
      }
    }
  }
  const tile = (r, c) => tiles[r * COLS + c];

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

  function drawCharCanvas(ctx, pose) {
    const J = 2.5;
    ctx.setTransform(TEX_SCALE, 0, 0, TEX_SCALE, 0, 0);
    ctx.clearRect(0, 0, CHAR_PX_W, CHAR_PX_H);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = 7;

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
    ctx.strokeStyle = "#b3402e";
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
  const charGeometry = new THREE.PlaneGeometry(0.86, 1.075);
  charGeometry.translate(0, 1.075 / 2, 0); // pivot at the feet
  const charMesh = new THREE.Mesh(
    charGeometry,
    new THREE.MeshBasicMaterial({ map: charTexture, transparent: true })
  );
  charMesh.renderOrder = 1; // only transparent mesh left — draw after keycaps
  const charTilt = { z: 0 }; // cartoon lean, composed into the billboard quat
  const charPosFor = (r, c) => {
    const { x, z } = tileAt(r, c);
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

  // "Sketch boil": re-jitter the ink a few times a second so it feels alive.
  setInterval(() => {
    if (document.hidden) return;
    for (const t of tiles) {
      drawTileCanvas(t.ctx, t.word);
      t.texture.needsUpdate = true;
    }
    drawTileSideCanvas(sideCtx);
    sideTexture.needsUpdate = true;
    drawCharCanvas(charCtx, charPose);
    charTexture.needsUpdate = true;
    drawNavArrows();
  }, 340);

  // ---- sounds: a tiny Web Audio sketch-synth ----
  // Every cue is an oscillator doodle or a pinch of filtered noise — no
  // samples to load, and the bleeps match the hand-drawn look.

  let ac = null;
  let masterGain = null;
  function audio() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      masterGain = ac.createGain();
      masterGain.gain.value = 0.4;
      masterGain.connect(ac.destination);
    }
    if (ac.state === "suspended") ac.resume();
    return ac;
  }
  // Sounds often fire from gsap timelines (outside any user gesture), so
  // unlock the context on real gestures — these also resume after suspension.
  document.addEventListener("keydown", audio);
  document.addEventListener("pointerdown", audio);

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
    osc.connect(g).connect(masterGain);
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
    src.connect(filter).connect(g).connect(masterGain);
    src.start(t0);
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
    sfx.pop();
    const dur = 0.16 + word.length * 0.06; // writing pace scales with word length
    gsap.fromTo(
      text,
      { clipPath: "inset(-20% 100% -20% -10%)" },
      { clipPath: "inset(-20% -10% -20% -10%)", duration: dur, ease: "none" }
    );
  }

  function bonk() {
    sfx.bonk();
    gsap.timeline()
      .to(charTilt, { z: -0.13, duration: 0.05 })
      .to(charTilt, { z: 0.13, duration: 0.09, repeat: 2, yoyo: true })
      .to(charTilt, { z: 0, duration: 0.05 });
  }

  function hopTo(r, c) {
    state = "hopping";
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
    used += 1;

    // landed keycap press
    const t = tile(r, c);
    pressTile(t);
    const word = t.word;

    // the hop that EXCEEDS the budget kills — even onto "=". The fatal
    // word never makes it into the sentence: no chip.
    if (used > level.budget) return die();

    hud.update(used);
    setPose("idle");
    if (appendsWord(word)) {
      words.push(word);
      addChip(word);
    }

    if (word === "=") return submit();
    if (used === level.budget) {
      hud.warnFull();
      hintEl.textContent = "last hop! one more and you're out…";
      gsap.to(hintEl, { opacity: 1, duration: 0.3 });
    }
    state = "idle";
    if (buffered) {
      const dir = buffered;
      buffered = null;
      tryMove(dir);
    }
  }

  // Overflow death: a dizzy wobble, then the doodle crumples and slides
  // clean off the bottom of the board.
  function die() {
    state = "dead";
    buffered = null;
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
    stampEl.textContent = "out of hops!";
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
    [...chipsEl.querySelectorAll(".sq-chip")].forEach((c) => c.remove());
    hud.reset();
    hintEl.textContent = remainingTargets().length
      ? HOP_HINT
      : "all targets collected! free hopping";
    gsap.to(hintEl, { opacity: 1, duration: 0.4 });
  }

  // Poof the doodle back onto its start tile (used by "hop again" and switches).
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
    const span = (Math.max(ROWS, COLS) - 1) * SPACING + TILE_SIZE;
    viewUnits = span + 1.2; // a little margin around the board
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
    // fov stays 32°; dolly the camera so the board fits either way
    // board-sized base, narrow-window fit, plus the landscape-phone zoom-out floor
    const need = Math.max(viewUnits, (viewUnits - 0.2) / aspect, short ? 9.4 : 0);
    camera.position.z = need / 2 / Math.tan(THREE.MathUtils.degToRad(32 / 2));
    camera.aspect = aspect;
    camera.lookAt(0, short ? 0.55 : 0.25, 0);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  new ResizeObserver(resize).observe(stage);

  // The board never moves, so the billboard's parent correction is constant.
  const _bbParentInv = new THREE.Quaternion();
  charGroup.getWorldQuaternion(_bbParentInv).invert();
  const _bbSpin = new THREE.Quaternion();
  const _Z = new THREE.Vector3(0, 0, 1);

  renderer.setAnimationLoop(() => {
    // billboard the doodle, then lean it by charTilt.z (bonks, deaths…)
    charMesh.quaternion
      .copy(_bbParentInv)
      .multiply(camera.quaternion)
      .multiply(_bbSpin.setFromAxisAngle(_Z, charTilt.z));
    renderer.render(scene, camera);
  });

  // ---- level nav: hand-drawn arrows that walk between boards ----
  const backBtn = element.querySelector(".sq-nav-back");
  const nextBtn = element.querySelector(".sq-nav-next");
  const backLabelEl = backBtn.querySelector(".sq-nav-label");
  const nextLabelEl = nextBtn.querySelector(".sq-nav-label");

  // Each arrow is an ink doodle baked to a small canvas, re-jittered by the boil.
  function makeArrowCanvas(host) {
    const cv = document.createElement("canvas");
    cv.width = 58 * TEX_SCALE;
    cv.height = 30 * TEX_SCALE;
    host.appendChild(cv);
    return cv;
  }
  function drawArrow(cv, dir) {
    const ctx = cv.getContext("2d");
    ctx.setTransform(TEX_SCALE, 0, 0, TEX_SCALE, 0, 0);
    ctx.clearRect(0, 0, 58, 30);
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.strokeStyle = INK_SOFT;
    ctx.lineWidth = 3.5;
    const y = 15;
    const tail = dir > 0 ? 6 : 52;
    const tip = dir > 0 ? 50 : 8;
    wobblyLine(ctx, tail, y, tip, y, 1.6); ctx.stroke(); // shaft
    wobblyLine(ctx, tip, y, tip - dir * 12, y - 8, 1.2); ctx.stroke(); // head, upper barb
    wobblyLine(ctx, tip, y, tip - dir * 12, y + 8, 1.2); ctx.stroke(); // head, lower barb
  }
  const backArrow = makeArrowCanvas(backBtn.querySelector(".sq-nav-arrow"));
  const nextArrow = makeArrowCanvas(nextBtn.querySelector(".sq-nav-arrow"));
  function drawNavArrows() {
    if (!backArrow) return;
    drawArrow(backArrow, -1);
    drawArrow(nextArrow, 1);
  }
  drawNavArrows();

  function revealNav(btn, show) {
    const wasHidden = btn.classList.contains("sq-hidden");
    if (!show) return btn.classList.add("sq-hidden");
    btn.classList.remove("sq-hidden");
    if (wasHidden) {
      gsap.fromTo(btn, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: "back.out(1.8)" });
    }
  }
  function updateNav() {
    const i = ORDER.indexOf(level.id);
    const hasBack = i > 0;
    // The forward arrow stays hidden until a target is collected on this board.
    const hasNext = i < ORDER.length - 1 && checkedOnThisLevel().size > 0;
    if (hasBack) backLabelEl.textContent = LEVELS[ORDER[i - 1]].title;
    if (hasNext) nextLabelEl.textContent = LEVELS[ORDER[i + 1]].title;
    revealNav(backBtn, hasBack);
    revealNav(nextBtn, hasNext);
  }
  backBtn.addEventListener("click", () => {
    const i = ORDER.indexOf(level.id);
    if (i > 0) { sfx.click(); loadLevel(ORDER[i - 1]); }
  });
  nextBtn.addEventListener("click", () => {
    const i = ORDER.indexOf(level.id);
    if (i < ORDER.length - 1) { sfx.click(); loadLevel(ORDER[i + 1]); }
  });

  // Swap the active board: rebuild tiles + checklist, reframe, poof in.
  function loadLevel(id) {
    gsap.killTweensOf([charMesh.scale, charMesh.position, charGroup.position, charTilt, charMesh.material]);
    overlayEl.classList.add("sq-hidden");
    overlayEl.style.opacity = "";
    level = LEVELS[id];
    state = "hopping"; // block input until the poof lands (then -> idle)
    buildTiles();
    buildTargets();
    resetGameState();
    reframe();
    updateNav();
    poofToStart();
  }

  loadLevel(data.home);
  root.dataset.state = "ready";
})();
