/**
 * @file globe.ts
 * @description Three.js interactive 3D globe module.
 * manages the scene, camera, renderer, globe geometry, connection lines,
 * and user interaction (hover/click raycasting).
 * renders a custom monochrome earth using specular map masking, and accurate
 * astronomical orbits for the Sun and Moon.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// global constants
const GLOBE_RADIUS = 5;
const NODE_SIZE = 0.08;
const GRID_SEGMENTS = 64;

export interface GlobeRegion {
  id: string;
  provider: "aws" | "gcp" | "azure";
  name: string;
  lat: number;
  lon: number;
  latency: number;
  status: "healthy" | "degraded" | "outage";
  isSimulated: boolean;
}

/**
 * helper to perform spherical linear interpolation (slerp) between two vectors.
 * writes the result into the target vector.
 */
function slerpVectors(
  v1: THREE.Vector3,
  v2: THREE.Vector3,
  t: number,
  target: THREE.Vector3
): THREE.Vector3 {
  const len1 = v1.length();
  const len2 = v2.length();
  
  const u1 = v1.clone().normalize();
  const u2 = v2.clone().normalize();
  
  const dot = Math.max(-1, Math.min(1, u1.dot(u2)));
  
  if (dot > 0.9995) {
    return target.copy(v1).lerp(v2, t);
  }
  
  if (dot < -0.9995) {
    const temp = Math.abs(u1.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const axis = new THREE.Vector3().crossVectors(u1, temp).normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(axis, t * Math.PI);
    const len = len1 + (len2 - len1) * t;
    return target.copy(u1).applyQuaternion(q).multiplyScalar(len);
  }
  
  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  
  const w1 = Math.sin((1 - t) * theta) / sinTheta;
  const w2 = Math.sin(t * theta) / sinTheta;
  
  const len = len1 + (len2 - len1) * t;
  return target.copy(u1).multiplyScalar(w1).addScaledVector(u2, w2).normalize().multiplyScalar(len);
}

interface Connection {
  targetId: string;
  particle: THREE.Mesh;
  progress: number;
  speed: number;
  delay: number;
  active: boolean;
  isInbound: boolean;
}

export class LatencyGlobe {
  private container: HTMLElement;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  
  // materials and lighting references
  private isDark = false;
  private landSphere!: THREE.Mesh;
  private globeSphere!: THREE.Mesh;
  private gridGroup!: THREE.Group;
  private nodesGroup!: THREE.Group;
  private connectionsGroup!: THREE.Group;
  private sunLight!: THREE.DirectionalLight;
  private sunMesh!: THREE.Mesh;
  private moonMesh!: THREE.Mesh;
  private ambientLight!: THREE.AmbientLight;
  
  // interaction state
  private regions: GlobeRegion[] = [];
  private selectedRegionId: string | null = null;
  private hoveredRegionId: string | null = null;
  private connections: Connection[] = [];

  // callbacks for ui integration
  private onSelectRegionCallback?: (regionId: string | null) => void;
  private onHoverRegionCallback?: (regionId: string | null) => void;

  constructor(container: HTMLElement, isDark: boolean) {
    this.container = container;
    this.isDark = isDark;
    
    this.initScene();
    this.initGlobe();
    this.initInteraction();
    this.animate();
  }

  /**
   * sets callbacks for region select and hover events.
   */
  public setCallbacks(
    onSelect: (regionId: string | null) => void,
    onHover: (regionId: string | null) => void
  ) {
    this.onSelectRegionCallback = onSelect;
    this.onHoverRegionCallback = onHover;
  }

  /**
   * sets up the three.js rendering context and lights.
   */
  private initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.isDark ? 0x09090b : 0xf8fafc);

    // set up camera
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 20000);
    this.camera.position.set(0, 5, 12);

    // set up renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    // set up orbital controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 6.5;
    this.controls.maxDistance = 500;

    // soft ambient light
    this.ambientLight = new THREE.AmbientLight(0xffffff, this.isDark ? 0.6 : 0.85);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xffffff, this.isDark ? 1.0 : 0.4);
    this.sunLight.castShadow = false; // direct lighting with no shadow mapping for performance
    this.scene.add(this.sunLight);

    // resize handler
    window.addEventListener("resize", this.handleResize.bind(this));
  }

  /**
   * draws the double-sphere monochrome globe, grid lines, sun, and moon.
   */
  private initGlobe() {
    // load high-quality monochrome earth specular map for land/water transparency masking
    const textureLoader = new THREE.TextureLoader();
    const specularMap = textureLoader.load(
      "https://threejs.org/examples/textures/planets/earth_specular_2048.jpg",
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        this.renderer.render(this.scene, this.camera);
      }
    );

    // 1a. inner land sphere (opaque to block back-facing nodes)
    const landGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 0.99, GRID_SEGMENTS, GRID_SEGMENTS);
    const landMat = new THREE.MeshLambertMaterial({
      color: this.isDark ? 0x27272a : 0xf1f5f9, // land: zinc-800 or slate-100
      transparent: false, // opaque blocks z-fighting / back-facing nodes
    });
    this.landSphere = new THREE.Mesh(landGeo, landMat);
    this.scene.add(this.landSphere);

    // 1b. outer ocean sphere (uses the specular map to mask transparency)
    const sphereGeo = new THREE.SphereGeometry(GLOBE_RADIUS, GRID_SEGMENTS, GRID_SEGMENTS);
    const sphereMat = new THREE.MeshLambertMaterial({
      color: this.isDark ? 0x09090b : 0xe2e8f0, // oceans: zinc-950 or slate-200
      alphaMap: specularMap,
      transparent: true,
      opacity: 0.95,
      depthWrite: true, // write depth to keep correct node clipping
    });
    this.globeSphere = new THREE.Mesh(sphereGeo, sphereMat);
    this.scene.add(this.globeSphere);

    // 2. wireframe latitude/longitude grid
    this.gridGroup = new THREE.Group();
    const gridMat = new THREE.LineBasicMaterial({
      color: this.isDark ? 0x27272a : 0xcbd5e1,
      transparent: true,
      opacity: 0.15,
    });

    // draw longitude circles (meridians)
    const segments = GRID_SEGMENTS;
    const circlePoints: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      circlePoints.push(new THREE.Vector3(Math.cos(theta) * GLOBE_RADIUS, 0, Math.sin(theta) * GLOBE_RADIUS));
    }
    const circleGeo = new THREE.BufferGeometry().setFromPoints(circlePoints);

    // 18 longitudinal lines (every 20 degrees)
    for (let i = 0; i < 18; i++) {
      const line = new THREE.Line(circleGeo, gridMat);
      line.rotation.y = (i / 18) * Math.PI;
      this.gridGroup.add(line);
    }

    // 9 latitudinal lines (parallels)
    for (let i = 1; i < 9; i++) {
      const lat = (i / 9) * Math.PI - Math.PI / 2;
      const y = GLOBE_RADIUS * Math.sin(lat);
      const r = GLOBE_RADIUS * Math.cos(lat);
      
      const latPoints: THREE.Vector3[] = [];
      for (let j = 0; j <= segments; j++) {
        const theta = (j / segments) * Math.PI * 2;
        latPoints.push(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r));
      }
      const latGeo = new THREE.BufferGeometry().setFromPoints(latPoints);
      const line = new THREE.Line(latGeo, gridMat);
      this.gridGroup.add(line);
    }

    this.scene.add(this.gridGroup);

    // 3. create the sun visual model
    const sunGeo = new THREE.CircleGeometry(22, 32);
    const sunMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a, // soft glowing yellow-200
      side: THREE.DoubleSide,
    });
    this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
    this.scene.add(this.sunMesh);
    // 4. create the moon visual model
    const moonGeo = new THREE.CircleGeometry(1.36, 32);
    const moonMat = new THREE.MeshBasicMaterial({
      transparent: true,
      side: THREE.DoubleSide,
    });
    this.moonMesh = new THREE.Mesh(moonGeo, moonMat);
    this.updateMoonTexture(this.isDark);
    this.scene.add(this.moonMesh);
    // initialize groups for dynamic objects
    this.nodesGroup = new THREE.Group();
    this.connectionsGroup = new THREE.Group();
    this.scene.add(this.nodesGroup);
    this.scene.add(this.connectionsGroup);
  }

  /**
   * sets up interaction hooks for mouse movements.
   */
  private initInteraction() {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const getIntersectedNode = (e: MouseEvent): THREE.Object3D | null => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, this.camera);
      const intersects = raycaster.intersectObjects(this.nodesGroup.children, true);
      
      if (intersects.length > 0) {
        let obj: THREE.Object3D | null = intersects[0].object;
        while (obj && obj !== this.nodesGroup) {
          if (obj.userData && obj.userData.regionId) {
            return obj;
          }
          obj = obj.parent;
        }
      }
      return null;
    };

    // mouse hover handler
    this.container.addEventListener("mousemove", (e) => {
      const node = getIntersectedNode(e);
      if (node) {
        this.container.style.cursor = "pointer";
        const regionId = node.userData.regionId as string;
        if (this.hoveredRegionId !== regionId) {
          this.hoveredRegionId = regionId;
          if (this.onHoverRegionCallback) {
            this.onHoverRegionCallback(regionId);
          }
        }
      } else {
        this.container.style.cursor = "default";
        if (this.hoveredRegionId !== null) {
          this.hoveredRegionId = null;
          if (this.onHoverRegionCallback) {
            this.onHoverRegionCallback(null);
          }
        }
      }
    });

    // mouse click handler
    this.container.addEventListener("click", (e) => {
      const node = getIntersectedNode(e);
      if (node) {
        const regionId = node.userData.regionId as string;
        this.selectRegion(regionId);
        if (this.onSelectRegionCallback) {
          this.onSelectRegionCallback(regionId);
        }
      }
    });
  }

  /**
   * updates region database and redraws nodes.
   */
  public updateRegions(regions: GlobeRegion[]) {
    this.regions = regions;
    
    // clear existing nodes
    while (this.nodesGroup.children.length > 0) {
      const obj = this.nodesGroup.children[0];
      this.nodesGroup.remove(obj);
    }

    // rebuild nodes - single clean sphere with no saturn rings
    const nodeGeo = new THREE.SphereGeometry(NODE_SIZE, 16, 16);

    for (const region of this.regions) {
      const pos = this.latLonToVector3(region.lat, region.lon);
      
      const regionNode = new THREE.Group();
      regionNode.position.copy(pos);
      regionNode.lookAt(new THREE.Vector3(0, 0, 0));
      regionNode.userData = { regionId: region.id };

      // pick status color
      let color = 0x10b981; // healthy green
      if (region.status === "outage") {
        color = 0xef4444; // outage red
      } else if (region.status === "degraded") {
        color = 0xf59e0b; // degraded amber
      }

      // inner node mesh
      const nodeMat = new THREE.MeshBasicMaterial({ color });
      const nodeMesh = new THREE.Mesh(nodeGeo, nodeMat);
      regionNode.add(nodeMesh);

      this.nodesGroup.add(regionNode);
    }

    // refresh connection lines if a region is selected
    if (this.selectedRegionId) {
      this.rebuildConnections();
    }
  }

  /**
   * highlights a single region and draws latency paths originating from it.
   */
  public selectRegion(regionId: string | null) {
    if (this.selectedRegionId === regionId) {
      return;
    }
    this.selectedRegionId = regionId;
    this.rebuildConnections();

    if (!regionId) {
      return;
    }

    // animate camera to focus on selected region
    const targetRegion = this.regions.find(r => r.id === regionId);
    if (targetRegion) {
      const pos = this.latLonToVector3(targetRegion.lat, targetRegion.lon);
      const targetCamPos = pos.clone().normalize().multiplyScalar(12);
      
      const camStart = this.camera.position.clone();
      const duration = 30; // frames
      let frame = 0;
      
      const animateCamera = () => {
        if (frame >= duration) {
          return;
        }
        frame++;
        const t = frame / duration;
        const ease = t * t * (3 - 2 * t);
        this.camera.position.lerpVectors(camStart, targetCamPos, ease);
        this.controls.target.set(0, 0, 0); // keep looking at center
        requestAnimationFrame(animateCamera);
      };
      
      animateCamera();
    }
  }

  /**
   * reconstructs geodesic connection curves radiating from the selected origin node.
   * uses spherical interpolation (slerp) to prevent curves from clipping through the earth.
   */
  private rebuildConnections() {
    // clear existing connections
    while (this.connectionsGroup.children.length > 0) {
      this.connectionsGroup.remove(this.connectionsGroup.children[0]);
    }
    this.connections = [];

    if (!this.selectedRegionId) {
      return;
    }

    const originRegion = this.regions.find(r => r.id === this.selectedRegionId);
    if (!originRegion) {
      return;
    }

    const originPos = this.latLonToVector3(originRegion.lat, originRegion.lon);

    for (const targetRegion of this.regions) {
      if (targetRegion.id === this.selectedRegionId) {
        continue;
      }

      const targetPos = this.latLonToVector3(targetRegion.lat, targetRegion.lon);
      
      // calculate geodesic parameters
      const distance = originPos.distanceTo(targetPos);
      
      // max arch height is 1.2 units above earth surface, proportional to distance
      const height = Math.min(0.5, (distance / (GLOBE_RADIUS * 2)) * 0.6);

      // generate slerped points along the geodesic path
      const points: THREE.Vector3[] = [];
      const divisions = 32;
      for (let i = 0; i <= divisions; i++) {
        const t = i / divisions;
        const p = new THREE.Vector3();
        slerpVectors(originPos, targetPos, t, p);
        // add dynamic arch height peaking at t = 0.5
        const archHeight = height * Math.sin(t * Math.PI);
        p.multiplyScalar((GLOBE_RADIUS + archHeight) / GLOBE_RADIUS);
        points.push(p);
      }
      
      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);

      // color code the line based on target region health status
      let lineColor = this.isDark ? 0x3f3f46 : 0xd1d5db; // default gray
      if (targetRegion.status === "outage") {
        lineColor = 0xef4444; // red
      } else if (targetRegion.status === "degraded") {
        lineColor = 0xf59e0b; // amber
      }

      const lineMat = new THREE.LineBasicMaterial({
        color: lineColor,
        transparent: true,
        opacity: 0.35,
      });

      const line = new THREE.Line(lineGeo, lineMat);
      this.connectionsGroup.add(line);

      // only spawn packets if neither server is down (outage)
      if (originRegion.status !== "outage" && targetRegion.status !== "outage") {
        const particleGeo = new THREE.SphereGeometry(0.02, 8, 8); // smaller dots
        const particleMat = new THREE.MeshBasicMaterial({
          color: 0x10b981, // green
          transparent: true,
          opacity: 0.9,
        });

        // constant speed across physical distance
        const speed = 0.08 / distance;

        // 1. outbound particle (origin -> target)
        const outParticle = new THREE.Mesh(particleGeo, particleMat);
        this.connectionsGroup.add(outParticle);
        this.connections.push({
          targetId: targetRegion.id,
          particle: outParticle,
          progress: Math.random(),
          speed,
          delay: Math.floor(Math.random() * 120),
          active: Math.random() > 0.5,
          isInbound: false,
        });

        // 2. inbound particle (target -> origin)
        const inParticle = new THREE.Mesh(particleGeo, particleMat);
        this.connectionsGroup.add(inParticle);
        this.connections.push({
          targetId: targetRegion.id,
          particle: inParticle,
          progress: Math.random(),
          speed,
          delay: Math.floor(Math.random() * 120),
          active: Math.random() > 0.5,
          isInbound: true,
        });
      }
    }
  }

  /**
   * translates global coordinates (latitude and longitude) to cartesian vectors.
   */
  private latLonToVector3(lat: number, lon: number): THREE.Vector3 {
    const phi = (lat * Math.PI) / 180;
    const theta = ((lon + 180) * Math.PI) / 180;

    const x = -(GLOBE_RADIUS * Math.cos(phi) * Math.sin(theta));
    const y = GLOBE_RADIUS * Math.sin(phi);
    const z = GLOBE_RADIUS * Math.cos(phi) * Math.cos(theta);

    return new THREE.Vector3(x, y, z);
  }

  /**
   * updates the sun and moon coordinates based on real UTC time.
   */
  private updateCelestialPositions() {
    const now = new Date();
    
    // 1. calculate sun position (longitude moving 15 degrees per hour, declination over year)
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const utcSeconds = now.getUTCSeconds();
    const utcMs = now.getUTCMilliseconds();
    
    const totalHours = utcHours + utcMinutes / 60 + utcSeconds / 3600 + utcMs / 3600000;
    const sunLon = -15 * (totalHours - 12); // centered at 0 deg at 12:00 UTC
    
    const startOfYear = new Date(now.getUTCFullYear(), 0, 1);
    const diffDays = (now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24);
    const declination = 23.44 * Math.sin(((2 * Math.PI) / 365) * (diffDays - 80)); // declination based on day count
    
    const sunPos = this.latLonToVector3(declination, sunLon).normalize().multiplyScalar(5000);
    
    if (this.sunLight) this.sunLight.position.copy(sunPos);
    if (this.sunMesh) this.sunMesh.position.copy(sunPos);

    // 2. calculate moon position (approx. 27.32 day sidereal orbit, 5.14 degree orbital tilt)
    const moonPeriodDays = 27.32166;
    const moonAngle = (diffDays / moonPeriodDays) * Math.PI * 2;
    const moonLat = declination + 5.14 * Math.sin(moonAngle);
    const moonLon = sunLon + (diffDays / 29.53059) * 360; // synodic period
    
    const moonPos = this.latLonToVector3(moonLat, moonLon).normalize().multiplyScalar(300);
    if (this.moonMesh) this.moonMesh.position.copy(moonPos);
  }

  /**
   * triggers theme-specific material shifts.
   */
  /**
   * draws the moon texture onto a 2D canvas representing the current lunar phase.
   * updates the canvas texture dynamically to match the theme.
   */
  private updateMoonTexture(dark: boolean) {
    const knownNewMoon = new Date(Date.UTC(2000, 0, 6, 18, 24, 0));
    const msSince = Date.now() - knownNewMoon.getTime();
    const daysSince = msSince / (1000 * 60 * 60 * 24);
    const lunarAge = daysSince % 29.53059;
    const phaseFraction = lunarAge / 29.53059;

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    
    ctx.clearRect(0, 0, 256, 256);
    
    // dark silhouette
    ctx.beginPath();
    ctx.arc(128, 128, 128, 0, Math.PI * 2);
    ctx.fillStyle = dark ? "#1f2937" : "#e2e8f0"; // slate-200 or gray-800
    ctx.fill();

    // lit portion based on lunar phase
    const phi = phaseFraction * Math.PI * 2;
    ctx.fillStyle = dark ? "#f3f4f6" : "#4b5563"; // gray-100 or gray-600
    const isRight = phaseFraction < 0.5;

    ctx.beginPath();
    if (isRight) {
      ctx.arc(128, 128, 128, -Math.PI / 2, Math.PI / 2);
    } else {
      ctx.arc(128, 128, 128, Math.PI / 2, -Math.PI / 2);
    }
    
    const termWidth = 128 * Math.cos(phi);
    if (isRight) {
      ctx.ellipse(128, 128, Math.abs(termWidth), 128, 0, Math.PI / 2, -Math.PI / 2, termWidth < 0);
    } else {
      ctx.ellipse(128, 128, Math.abs(termWidth), 128, 0, -Math.PI / 2, Math.PI / 2, termWidth < 0);
    }
    ctx.fill();

    const moonTexture = new THREE.CanvasTexture(canvas);
    moonTexture.colorSpace = THREE.SRGBColorSpace;
    
    if (this.moonMesh) {
      const oldMat = this.moonMesh.material as THREE.MeshBasicMaterial;
      if (oldMat.map) {
        oldMat.map.dispose();
      }
      oldMat.map = moonTexture;
      oldMat.needsUpdate = true;
    }
  }

  public setTheme(dark: boolean) {
    this.isDark = dark;
    this.scene.background = new THREE.Color(dark ? 0x09090b : 0xf8fafc);
    
    // update base sphere colors (oceans and land)
    if (this.globeSphere) {
      (this.globeSphere.material as THREE.MeshBasicMaterial).color.setHex(dark ? 0x09090b : 0xe2e8f0);
    }
    if (this.landSphere) {
      (this.landSphere.material as THREE.MeshBasicMaterial).color.setHex(dark ? 0x27272a : 0xf1f5f9);
    }

    // update lighting intensities
    if (this.ambientLight) {
      this.ambientLight.intensity = dark ? 0.6 : 0.85;
    }
    if (this.sunLight) {
      this.sunLight.intensity = dark ? 1.0 : 0.4;
    }
    this.updateMoonTexture(dark);

    // update grid lines color
    if (this.gridGroup) {
      this.gridGroup.children.forEach((obj) => {
        const line = obj as THREE.Line;
        (line.material as THREE.LineBasicMaterial).color.setHex(dark ? 0x27272a : 0xcbd5e1);
      });
    }

    // update connection curve colors
    if (this.connectionsGroup) {
      this.connectionsGroup.children.forEach((obj) => {
        const line = obj as THREE.Line;
        if (line.material) {
          (line.material as THREE.LineBasicMaterial).color.setHex(dark ? 0x3f3f46 : 0xd1d5db);
        }
      });
    }
  }

  /**
   * handles browser resizing events.
   */
  private handleResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /**
   * runs the animation frame loop.
   */
  private animate() {
    requestAnimationFrame(this.animate.bind(this));

    // 1. update controls damping
    this.controls.update();

    // 2. update sun and moon orbits
    this.updateCelestialPositions();
    if (this.sunMesh) this.sunMesh.lookAt(0, 0, 0);
    if (this.moonMesh) this.moonMesh.lookAt(0, 0, 0);

    // 3. slowly rotate globe when no region is selected
    if (!this.selectedRegionId) {
      this.globeSphere.rotation.y += 0.0005;
      if (this.gridGroup) this.gridGroup.rotation.y += 0.0005;
      if (this.nodesGroup) this.nodesGroup.rotation.y += 0.0005;
      if (this.landSphere) this.landSphere.rotation.y += 0.0005;
    } else {
      // snap back rotations smoothly
      this.globeSphere.rotation.y = 0;
      if (this.gridGroup) this.gridGroup.rotation.y = 0;
      if (this.nodesGroup) this.nodesGroup.rotation.y = 0;
      if (this.landSphere) this.landSphere.rotation.y = 0;
    }

    // 4. animate latency particles along curves (constant speed)
    if (this.selectedRegionId && this.connections.length > 0) {
      const originRegion = this.regions.find(r => r.id === this.selectedRegionId);
      if (originRegion) {
        const originPos = this.latLonToVector3(originRegion.lat, originRegion.lon);
        this.connections.forEach((conn) => {
          if (conn.active) {
            conn.progress += conn.speed;
            if (conn.progress >= 1.0) {
              conn.active = false;
              conn.progress = 0;
              conn.delay = Math.floor(Math.random() * 120) + 30; // 30 to 150 frames delay
              conn.particle.visible = false;
            }
          } else {
            conn.delay--;
            if (conn.delay <= 0) {
              conn.active = true;
              conn.particle.visible = true;
            }
          }

          if (conn.active) {
            const targetRegion = this.regions.find(r => r.id === conn.targetId);
            if (targetRegion) {
              const targetPos = this.latLonToVector3(targetRegion.lat, targetRegion.lon);
              const distance = originPos.distanceTo(targetPos);
              const height = Math.min(0.5, (distance / (GLOBE_RADIUS * 2)) * 0.6);
              
              // use progress or 1.0 - progress based on direction
              const t = conn.isInbound ? 1.0 - conn.progress : conn.progress;
              
              // slerp interpolation for position
              slerpVectors(originPos, targetPos, t, conn.particle.position);
              
              // arch height scaling
              const archHeight = height * Math.sin(t * Math.PI);
              conn.particle.position.multiplyScalar((GLOBE_RADIUS + archHeight) / GLOBE_RADIUS);
            }
          }
        });

      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}
