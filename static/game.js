// Semantique — three.js paper scene inside a single gr.HTML component.
// `element`, `props`, `server` are provided by Gradio; `gsap` is global (head).

(async () => {
  const THREE = await import("https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js");

  const level = props.value; // { grid, start, target, budget, labels }
  const root = element.querySelector(".sq-root");
  const stage = element.querySelector(".sq-stage");

  // ---- HUD ----
  element.querySelector(".sq-target-word").textContent = level.target;
  const pipsEl = element.querySelector(".sq-pips");
  for (let i = 0; i < level.budget; i++) {
    const pip = document.createElement("span");
    pip.className = "sq-pip";
    pip.style.setProperty("--tilt", `${(Math.random() * 8 - 4).toFixed(1)}deg`);
    pipsEl.appendChild(pip);
  }

  // ---- three.js paper scene ----
  const PAPER = 0xfaf8f2;
  const scene = new THREE.Scene(); // background stays transparent: CSS paper + ruled lines show through

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, 10, 7);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  stage.appendChild(renderer.domElement);

  // Board group: everything sits here, tilted like a sketch on a table.
  const board = new THREE.Group();
  board.rotation.z = THREE.MathUtils.degToRad(1.5);
  scene.add(board);

  const VIEW = 6.2; // world units visible vertically
  function resize() {
    const w = stage.clientWidth || 1;
    const h = stage.clientHeight || 1;
    const aspect = w / h;
    camera.left = -VIEW * aspect / 2;
    camera.right = VIEW * aspect / 2;
    camera.top = VIEW / 2;
    camera.bottom = -VIEW / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  renderer.setAnimationLoop(() => renderer.render(scene, camera));

  root.dataset.state = "ready";
})();
