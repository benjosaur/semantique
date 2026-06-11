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

  function drawCharCanvas(ctx, pose) {
    const J = 2.5;
    ctx.clearRect(0, 0, CHAR_PX_W, CHAR_PX_H);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = 7;

    // head
    wobblyCircle(ctx, 128, 96, 50, 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,253,247,0.9)";
    ctx.fill();
    ctx.fillStyle = INK;

    // face
    const blink = pose === "idle" && Math.random() < 0.18;
    if (blink) {
      wobblyLine(ctx, 102, 92, 118, 92, 1); ctx.stroke();
      wobblyLine(ctx, 138, 92, 154, 92, 1); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(110, 90, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(146, 90, 5.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.beginPath();
    if (pose === "think") {
      ctx.arc(128, 116, 9, 0, Math.PI * 2); // little "o" mouth
      ctx.stroke();
    } else {
      ctx.arc(128, 104, 22, Math.PI * 0.18, Math.PI * 0.82); // smile
      ctx.stroke();
    }

    // body
    wobblyLine(ctx, 128, 146, 128, 236, J); ctx.stroke();

    // arms + legs by pose
    if (pose === "hop") {
      wobblyLine(ctx, 128, 172, 76, 122, J); ctx.stroke();
      wobblyLine(ctx, 128, 172, 180, 122, J); ctx.stroke();
      wobblyLine(ctx, 128, 236, 96, 270, J); ctx.stroke();
      wobblyLine(ctx, 128, 236, 162, 268, J); ctx.stroke();
    } else if (pose === "think") {
      wobblyLine(ctx, 128, 176, 88, 210, J); ctx.stroke();
      wobblyLine(ctx, 128, 176, 158, 142, J); ctx.stroke(); // hand to chin
      wobblyLine(ctx, 128, 236, 104, 302, J); ctx.stroke();
      wobblyLine(ctx, 128, 236, 152, 302, J); ctx.stroke();
      ctx.font = '400 56px "Patrick Hand"';
      ctx.textAlign = "center";
      ctx.fillText("?", 196 + rand(-2, 2), 56 + rand(-2, 2));
    } else {
      wobblyLine(ctx, 128, 176, 90, 216, J); ctx.stroke();
      wobblyLine(ctx, 128, 176, 166, 216, J); ctx.stroke();
      wobblyLine(ctx, 128, 236, 104, 302, J); ctx.stroke();
      wobblyLine(ctx, 128, 236, 152, 302, J); ctx.stroke();
    }
  }

  const charCanvas = document.createElement("canvas");
  charCanvas.width = CHAR_PX_W;
  charCanvas.height = CHAR_PX_H;
  const charCtx = charCanvas.getContext("2d");
  let charPose = "idle";
  drawCharCanvas(charCtx, charPose);

  const charTexture = new THREE.CanvasTexture(charCanvas);
  charTexture.colorSpace = THREE.SRGBColorSpace;
  const CHAR_BASE_Y = 0.66;
  const CHAR_Z_OFF = -0.34; // stand toward the tile's top edge, not on the word
  const charMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.86, 1.075),
    new THREE.MeshBasicMaterial({ map: charTexture, transparent: true })
  );
  const charPosFor = (r, c) => {
    const { x, z } = tileAt(r, c);
    return { x, z: z + CHAR_Z_OFF };
  };
  const startPos = charPosFor(level.start[0], level.start[1]);
  charMesh.position.set(startPos.x, CHAR_BASE_Y, startPos.z);
  board.add(charMesh);

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
    drawCharCanvas(charCtx, charPose);
    charTexture.needsUpdate = true;
  }, 340);

  // ---- game state ----

  const chipsEl = element.querySelector(".sq-chips");
  const hintEl = element.querySelector(".sq-hint");
  const pips = [...pipsEl.children];

  let state = "idle"; // idle | hopping | judging | verdict
  let pos = [...level.start];
  let words = []; // appended (non-structural) words
  let used = 0; // hops spent

  function addChip(word) {
    const chip = document.createElement("span");
    chip.className = "sq-chip";
    chip.style.setProperty("--tilt", `${rand(-2, 2).toFixed(1)}deg`);
    chip.textContent = word;
    chipsEl.appendChild(chip);
    gsap.from(chip, { scale: 0, rotation: rand(-14, 14), duration: 0.35, ease: "back.out(2.5)" });
  }

  function bonk() {
    gsap.timeline()
      .to(charMesh.rotation, { z: -0.13, duration: 0.05 })
      .to(charMesh.rotation, { z: 0.13, duration: 0.09, repeat: 2, yoyo: true })
      .to(charMesh.rotation, { z: 0, duration: 0.05 });
  }

  function hopTo(r, c) {
    state = "hopping";
    const { x, z } = charPosFor(r, c);
    setPose("hop");
    gsap.timeline({ onComplete: () => land(r, c) })
      .to(charMesh.scale, { x: 1.18, y: 0.78, duration: 0.09, ease: "power1.in" }) // anticipation squash
      .to(charMesh.scale, { x: 0.94, y: 1.12, duration: 0.1 })
      .to(charMesh.position, { x, z, duration: 0.27, ease: "none" }, 0.09)
      .to(charMesh.position, { y: CHAR_BASE_Y + 0.8, duration: 0.14, ease: "power2.out" }, 0.09)
      .to(charMesh.position, { y: CHAR_BASE_Y, duration: 0.13, ease: "power2.in" }, 0.23)
      .to(charMesh.scale, { x: 1.1, y: 0.86, duration: 0.07 }, 0.36) // landing squash
      .to(charMesh.scale, { x: 1, y: 1, duration: 0.12, ease: "back.out(3)" }, 0.43);
  }

  function land(r, c) {
    pos = [r, c];
    used += 1;
    if (pips[used - 1]) pips[used - 1].classList.add("sq-used");
    setPose("idle");

    // landed-tile stamp pulse
    const t = tile(r, c);
    gsap.timeline()
      .to(t.mesh.scale, { x: 1.07, y: 1.07, duration: 0.09 })
      .to(t.mesh.scale, { x: 1, y: 1, duration: 0.18, ease: "back.out(2)" });

    const word = t.word;
    if (word !== "<bos>" && word !== "<eos>") {
      words.push(word);
      addChip(word);
    }

    if (word === "<eos>") return submit(false);
    if (used >= level.budget) return submit(true);
    state = "idle";
    if (buffered) {
      const dir = buffered;
      buffered = null;
      tryMove(dir);
    }
  }

  // ---- judging + verdict ----

  const overlayEl = element.querySelector(".sq-overlay");
  const cardEl = element.querySelector(".sq-card");
  const sentenceEl = element.querySelector(".sq-card-sentence");
  const barsEl = element.querySelector(".sq-bars");
  const stampEl = element.querySelector(".sq-stamp");
  const retryBtn = element.querySelector(".sq-retry");
  const againBtn = element.querySelector(".sq-again");

  async function submit(overflow) {
    state = "judging";
    buffered = null;
    setPose("think");
    hintEl.textContent = overflow
      ? "context window overflowed! the judge reads it anyway…"
      : "the judge is reading…";
    gsap.to(hintEl, { opacity: 1, duration: 0.3 });
    const bob = gsap.to(charMesh.position, {
      y: CHAR_BASE_Y + 0.12, duration: 0.55, repeat: -1, yoyo: true, ease: "sine.inOut",
    });
    const slowTimer = setTimeout(() => {
      hintEl.textContent = "the tiny model is stretching its parameters…";
    }, 4000);

    let res;
    try {
      res = await server.judge({ words, target: level.target, labels: level.labels });
    } catch (err) {
      res = { ok: false, error: String(err) };
    }
    clearTimeout(slowTimer);
    bob.kill();
    gsap.to(charMesh.position, { y: CHAR_BASE_Y, duration: 0.2 });

    if (!res || !res.ok) return judgeFailed(overflow, res && res.error);
    showVerdict(res, overflow);
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

  function judgeFailed(overflow, error) {
    console.warn("judge failed:", error);
    sentenceEl.textContent = "the judge dozed off…";
    barsEl.innerHTML = "";
    stampEl.style.opacity = 0;
    retryBtn.classList.remove("sq-hidden");
    againBtn.classList.add("sq-hidden");
    retryBtn.onclick = () => {
      overlayEl.classList.add("sq-hidden");
      submit(overflow);
    };
    openCard();
  }

  function showVerdict(res, overflow) {
    state = "verdict";
    setPose(res.verdict === "win" ? "hop" : "idle");
    hintEl.textContent = "";

    sentenceEl.innerHTML = "";
    const quote = document.createElement("div");
    quote.textContent = `“${res.sentence}”`;
    sentenceEl.appendChild(quote);
    if (overflow) {
      const note = document.createElement("div");
      note.textContent = "— context window overflowed —";
      note.style.cssText = "font-family:'Patrick Hand',cursive;font-size:17px;color:#b3402e;";
      sentenceEl.appendChild(note);
    }

    // probability bars, sorted by prob so the verdict reads top-down
    barsEl.innerHTML = "";
    const entries = Object.entries(res.probs).sort((a, b) => b[1] - a[1]);
    const fills = [];
    for (const [label, p] of entries) {
      const row = document.createElement("div");
      row.className = "sq-bar-row" + (label === level.target ? " sq-bar-target" : "");
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
    stampEl.textContent = res.verdict === "win" ? `${res.winner}!` : `${res.winner}.`;
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
      { opacity: 1, scale: 1, rotation: 8, duration: 0.3, ease: "power3.in" },
      ">-0.1"
    ).to(cardEl, { x: "+=5", yoyo: true, repeat: 3, duration: 0.04 }, ">"); // thump
  }

  // ---- reset ----

  function reset() {
    gsap.to(overlayEl, {
      autoAlpha: 0, duration: 0.25,
      onComplete: () => {
        overlayEl.classList.add("sq-hidden");
        overlayEl.style.opacity = "";
      },
    });

    words = [];
    used = 0;
    pos = [...level.start];
    [...chipsEl.querySelectorAll(".sq-chip:not(.sq-chip-bos)")].forEach((c) => c.remove());
    pips.forEach((p) => p.classList.remove("sq-used"));
    hintEl.textContent = "arrow keys / WASD to hop";
    gsap.to(hintEl, { opacity: 1, duration: 0.4 });

    // poof back to <bos>
    const home = charPosFor(level.start[0], level.start[1]);
    gsap.timeline({ onComplete: () => (state = "idle") })
      .to(charMesh.scale, { x: 0, y: 0, duration: 0.18, ease: "power2.in" })
      .add(() => {
        charMesh.position.set(home.x, CHAR_BASE_Y, home.z);
        setPose("idle");
      })
      .to(charMesh.scale, { x: 1, y: 1, duration: 0.28, ease: "back.out(2.5)" });
  }

  againBtn.addEventListener("click", reset);

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

  document.addEventListener("keydown", (e) => {
    const dir = DIRS[e.key.toLowerCase()];
    if (!dir || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    if (state === "hopping" && !buffered) {
      buffered = dir;
      return;
    }
    if (state !== "idle") return;
    tryMove(dir);
  });

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

  renderer.setAnimationLoop(() => {
    charMesh.quaternion.copy(camera.quaternion); // billboard the doodle
    renderer.render(scene, camera);
  });

  root.dataset.state = "ready";
})();
