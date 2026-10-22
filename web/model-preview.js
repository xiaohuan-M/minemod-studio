import * as THREE from '/vendor/three.js';
import { OrbitControls } from '/vendor/OrbitControls.js';
/** Minecraft cube renderer. No model URLs, network textures, eval or embedded scripts. */
export function modelPreview(canvas, onSelect = () => {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
  } catch {
    canvas.dataset.renderer = 'unavailable';
    const p = document.createElement('p');
    p.textContent = '此浏览器无法创建 WebGL 预览。仍可编辑参数并导出模型。';
    canvas.after(p);
    return {
      set() {},
      texture() {},
      view() {},
      select() {},
      capture() {
        throw new Error('WebGL 不可用。');
      },
    };
  }
  canvas.dataset.renderer = 'three';
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor('#e8eee4');
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.minDistance = 10;
  controls.maxDistance = 140;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x66725d, 2.3));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(25, 50, 35);
  scene.add(light);
  const grid = new THREE.GridHelper(64, 16, 0x71806b, 0xb8c6b1);
  grid.position.y = -8.05;
  scene.add(grid);
  const root = new THREE.Group(),
    mannequin = new THREE.Group();
  scene.add(root, mannequin);
  let model = { elements: [] },
    map = null,
    selected = -1,
    mode = 'orbit',
    meshes = [],
    helper = null;
  function draw() {
    if (canvas.clientWidth && canvas.clientHeight) {
      const w = canvas.clientWidth,
        h = canvas.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
  }
  controls.addEventListener('change', draw);
  new ResizeObserver(draw).observe(canvas);
  function dispose(group) {
    group.traverse((n) => {
      n.geometry?.dispose();
      if (n.material)
        for (const m of Array.isArray(n.material) ? n.material : [n.material]) m.dispose();
    });
    group.clear();
  }
  function pose() {
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.set(1, 1, 1);
    const slot = { hand: 'thirdperson_righthand', head: 'head', gui: 'gui', ground: 'ground' }[
      mode
    ];
    const t = model.display?.[slot] ?? {};
    root.rotation.set(...(t.rotation ?? [0, 0, 0]).map(THREE.MathUtils.degToRad));
    root.position.fromArray(t.translation ?? [0, 0, 0]);
    root.scale.fromArray(t.scale ?? [1, 1, 1]);
    mannequin.visible = ['hand', 'head'].includes(mode);
    if (mode === 'hand') mannequin.position.set(-10, -13, 1);
    else mannequin.position.set(0, -25, 0);
  }
  for (const [size, pos] of [
    [
      [8, 8, 8],
      [0, 20, 0],
    ],
    [
      [8, 12, 4],
      [0, 10, 0],
    ],
    [
      [4, 12, 4],
      [-6, 10, 0],
    ],
    [
      [4, 12, 4],
      [6, 10, 0],
    ],
    [
      [4, 12, 4],
      [-2, -2, 0],
    ],
    [
      [4, 12, 4],
      [2, -2, 0],
    ],
  ]) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...size),
      new THREE.MeshStandardMaterial({ color: 0x809279, transparent: true, opacity: 0.45 }),
    );
    mesh.position.fromArray(pos);
    mannequin.add(mesh);
  }
  function highlight() {
    if (helper) {
      scene.remove(helper);
      helper.geometry.dispose();
      helper.material.dispose();
      helper = null;
    }
    if (meshes[selected]) {
      root.updateMatrixWorld(true);
      helper = new THREE.BoxHelper(meshes[selected], 0xefad36);
      scene.add(helper);
    }
  }
  function rebuild() {
    dispose(root);
    meshes = [];
    model.elements.forEach((e, index) => {
      const geometry = new THREE.BoxGeometry(...e.to.map((n, i) => n - e.from[i]));
      const uv = geometry.attributes.uv;
      const faces = ['east', 'west', 'up', 'down', 'south', 'north'];
      const materials = faces.map((name, faceIndex) => {
        const f = e.faces?.[name];
        const [a, b, c, d] = f?.uv ?? [0, 0, 16, 16];
        let points = [
          [a / 16, 1 - b / 16],
          [c / 16, 1 - b / 16],
          [a / 16, 1 - d / 16],
          [c / 16, 1 - d / 16],
        ];
        // Rotate UV corners around the face without changing its geometry.
        for (let r = 0; r < (f?.rotation ?? 0) / 90; r++)
          points = [points[2], points[0], points[3], points[1]];
        points.forEach(([u, v], i) => uv.setXY(faceIndex * 4 + i, u, v));
        return new THREE.MeshStandardMaterial({
          color: map ? 0xffffff : 0xb39ad5,
          map,
          roughness: 1,
          alphaTest: 0.1,
          visible: f !== null,
          side: THREE.FrontSide,
        });
      });
      const mesh = new THREE.Mesh(geometry, materials),
        pivot = new THREE.Group();
      mesh.userData.index = index;
      const origin = e.rotation?.origin ?? [8, 8, 8];
      mesh.position.fromArray(e.from.map((v, i) => (v + e.to[i]) / 2 - origin[i]));
      pivot.position.fromArray(origin.map((v) => v - 8));
      if (e.rotation) {
        pivot.rotation[e.rotation.axis] = THREE.MathUtils.degToRad(e.rotation.angle);
        if (e.rotation.rescale) {
          const factor = 1 / Math.cos(THREE.MathUtils.degToRad(e.rotation.angle));
          for (const axis of ['x', 'y', 'z'])
            if (axis !== e.rotation.axis) pivot.scale[axis] = factor;
        }
      }
      pivot.add(mesh);
      root.add(pivot);
      meshes.push(mesh);
    });
    pose();
    highlight();
    draw();
  }
  let down;
  canvas.addEventListener('pointerdown', (e) => {
    down = [e.clientX, e.clientY];
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const rect = canvas.getBoundingClientRect(),
      ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((e.clientY - rect.top) / rect.height) * 2,
      ),
      camera,
    );
    const hit = ray.intersectObjects(meshes, false)[0];
    if (hit) onSelect(hit.object.userData.index);
  });
  const api = {
    set(value) {
      model = value;
      rebuild();
    },
    texture(value) {
      map?.dispose();
      if (value) {
        const data = new Uint8Array(
          value.pixels.flatMap((p) => [1, 3, 5, 7].map((at) => parseInt(p.slice(at, at + 2), 16))),
        );
        map = new THREE.DataTexture(data, value.width, value.height);
        map.flipY = true;
        map.colorSpace = THREE.SRGBColorSpace;
        map.magFilter = THREE.NearestFilter;
        map.minFilter = THREE.NearestFilter;
        map.needsUpdate = true;
      } else map = null;
      rebuild();
    },
    select(index) {
      selected = index;
      highlight();
      draw();
    },
    view(value) {
      mode = value;
      camera.position.fromArray(
        value === 'front' ? [0, 0, 55] : value === 'gui' ? [30, 24, 40] : [36, 26, 42],
      );
      controls.target.set(0, 0, 0);
      controls.update();
      pose();
      highlight();
      draw();
    },
    capture() {
      draw();
      return canvas.toDataURL('image/png');
    },
  };
  api.view('orbit');
  return api;
}
