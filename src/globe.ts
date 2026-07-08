/**
 * @file globe.ts
 * @description Three.js interactive 3D globe module.
 * manages the scene, camera, renderer, globe geometry, connection lines,
 * latency particle animations, and user interaction (hover/click raycasting).
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// global constants
const GLOBE_RADIUS = 5;
const NODE_SIZE = 0.08;
const PARTICLE_SIZE = 0.04;
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

interface Connection {
  targetId: string;
  curve: THREE.QuadraticBezierCurve3;
  line: THREE.Line;
  particle: THREE.Mesh;
  progress: number;
  speed: number;
}

export class LatencyGlobe {
  private container: HTMLElement;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  
  // materials and geometry references for theme updates
  private isDark = false;
  private globeSphere!: THREE.Mesh;
  private gridGroup!: THREE.Group;
  private nodesGroup!: THREE.Group;
  private connectionsGroup!: THREE.Group;
  
  // interaction state
  private regions: GlobeRegion[] = [];
  private selectedRegionId: string | null = null;
  private hoveredRegionId: string | null = null;
  private connections: Connection[] = [];
  private pulseScale = 1.0;
  private pulseDirection = 1;

  // callbacks for ui integration
  private onSelectRegionCallback?: (regionId: string) => void;
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
    onSelect: (regionId: string) => void,
    onHover: (regionId: string | null) => void
  ) {
    this.onSelectRegionCallback = onSelect;
    this.onHoverRegionCallback = onHover;
  }

  /**
   * sets up the three.js rendering context.
   */
  private initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.isDark ? 0x09090b : 0xf8fafc);

    // set up camera
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
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
    this.controls.maxDistance = 20;

    // soft ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambientLight);

    // directional light for subtle shadowing
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(5, 10, 7);
    this.scene.add(dirLight);

    // resize handler
    window.addEventListener("resize", this.handleResize.bind(this));
  }

  /**
   * draws the core globe sphere and the grid lines.
   */
  private initGlobe() {
    // 1. base sphere
    const sphereGeo = new THREE.SphereGeometry(GLOBE_RADIUS, GRID_SEGMENTS, GRID_SEGMENTS);
    const sphereMat = new THREE.MeshBasicMaterial({
      color: this.isDark ? 0x18181b : 0xe2e8f0,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
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
    gridMat.color.setHex(this.isDark ? 0x27272a : 0xcbd5e1);

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
        // return parent mesh (node group)
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

    // rebuild nodes
    const nodeGeo = new THREE.SphereGeometry(NODE_SIZE, 16, 16);
    const ringGeo = new THREE.RingGeometry(NODE_SIZE * 1.2, NODE_SIZE * 2.2, 32);

    for (const region of this.regions) {
      const pos = this.latLonToVector3(region.lat, region.lon);
      
      const regionNode = new THREE.Group();
      regionNode.position.copy(pos);
      // look away from center for ring alignment
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

      // outer pulsing radar ring mesh
      const ringMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      // orient flat against sphere surface
      ringMesh.rotation.x = Math.PI / 2;
      regionNode.add(ringMesh);

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
  public selectRegion(regionId: string) {
    if (this.selectedRegionId === regionId) {
      return;
    }
    this.selectedRegionId = regionId;
    this.rebuildConnections();

    // animate camera to focus on selected region
    const targetRegion = this.regions.find(r => r.id === regionId);
    if (targetRegion) {
      const pos = this.latLonToVector3(targetRegion.lat, targetRegion.lon);
      // normalize and push camera back slightly
      const targetCamPos = pos.clone().normalize().multiplyScalar(12);
      
      // smooth interpolation using a simple tween in the animation loop
      const camStart = this.camera.position.clone();
      const duration = 30; // frames
      let frame = 0;
      
      const animateCamera = () => {
        if (frame >= duration) {
          return;
        }
        frame++;
        const t = frame / duration;
        // smooth step easing
        const ease = t * t * (3 - 2 * t);
        this.camera.position.lerpVectors(camStart, targetCamPos, ease);
        this.controls.target.set(0, 0, 0); // keep looking at center
        requestAnimationFrame(animateCamera);
      };
      
      animateCamera();
    }
  }

  /**
   * reconstructs bezier connection curves radiating from the selected origin node.
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
    const lineMat = new THREE.LineBasicMaterial({
      color: this.isDark ? 0x3f3f46 : 0xd1d5db,
      transparent: true,
      opacity: 0.25,
    });

    const particleGeo = new THREE.SphereGeometry(PARTICLE_SIZE, 8, 8);

    for (const targetRegion of this.regions) {
      if (targetRegion.id === this.selectedRegionId) {
        continue;
      }

      const targetPos = this.latLonToVector3(targetRegion.lat, targetRegion.lon);
      
      // 1. calculate bezier control point to arch above sphere surface
      const midPoint = new THREE.Vector3().addVectors(originPos, targetPos).multiplyScalar(0.5);
      const distance = originPos.distanceTo(targetPos);
      
      // height based on distance (maximum arch height = 1.5 units)
      const height = Math.min(1.5, (distance / (GLOBE_RADIUS * 2)) * 2.0);
      const controlPoint = midPoint.clone().normalize().multiplyScalar(GLOBE_RADIUS + height);

      const curve = new THREE.QuadraticBezierCurve3(originPos, controlPoint, targetPos);
      
      // 2. generate curved line mesh
      const points = curve.getPoints(32);
      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(lineGeo, lineMat);
      this.connectionsGroup.add(line);

      // 3. generate latency tracker particle
      let statusColor = 0x10b981; // green
      if (targetRegion.status === "outage") {
        statusColor = 0xef4444; // red
      } else if (targetRegion.status === "degraded") {
        statusColor = 0xf59e0b; // amber
      }

      const particleMat = new THREE.MeshBasicMaterial({ color: statusColor });
      const particle = new THREE.Mesh(particleGeo, particleMat);
      this.connectionsGroup.add(particle);

      // calculate speed: higher latency = slower particle speed
      // speed maps 10ms -> 0.01 progress/frame, 500ms -> 0.001 progress/frame
      const speed = Math.max(0.001, Math.min(0.015, 0.1 / (targetRegion.latency || 50)));

      this.connections.push({
        targetId: targetRegion.id,
        curve,
        line,
        particle,
        progress: Math.random(), // randomize start position to offset particles
        speed,
      });
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
   * triggers theme-specific material shifts.
   */
  public setTheme(dark: boolean) {
    this.isDark = dark;
    this.scene.background = new THREE.Color(dark ? 0x09090b : 0xf8fafc);
    
    // update base sphere color
    if (this.globeSphere) {
      (this.globeSphere.material as THREE.MeshBasicMaterial).color.setHex(dark ? 0x18181b : 0xe2e8f0);
    }

    // update grid lines color
    if (this.gridGroup) {
      this.gridGroup.children.forEach((obj) => {
        const line = obj as THREE.Line;
        (line.material as THREE.LineBasicMaterial).color.setHex(dark ? 0x27272a : 0xcbd5e1);
      });
    }

    // update connection curve colors
    if (this.connections.length > 0) {
      this.connections.forEach((conn) => {
        (conn.line.material as THREE.LineBasicMaterial).color.setHex(dark ? 0x3f3f46 : 0xd1d5db);
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

    // 2. slowly rotate globe when no region is selected
    if (!this.selectedRegionId) {
      this.globeSphere.rotation.y += 0.0005;
      this.gridGroup.rotation.y += 0.0005;
      this.nodesGroup.rotation.y += 0.0005;
    } else {
      // snap back rotations smoothly
      this.globeSphere.rotation.y = 0;
      this.gridGroup.rotation.y = 0;
      this.nodesGroup.rotation.y = 0;
    }

    // 3. animate node outer rings (pulsing radar effect)
    this.pulseScale += 0.015 * this.pulseDirection;
    if (this.pulseScale > 2.2 || this.pulseScale < 1.0) {
      this.pulseDirection *= -1;
    }

    this.nodesGroup.children.forEach((child) => {
      const group = child as THREE.Group;
      if (group.children.length > 1) {
        const ring = group.children[1] as THREE.Mesh;
        ring.scale.set(this.pulseScale, this.pulseScale, 1);
        
        // fade opacity out as ring expands
        const ringMat = ring.material as THREE.MeshBasicMaterial;
        ringMat.opacity = Math.max(0, 0.5 - (this.pulseScale - 1.0) * 0.4);
      }
    });

    // 4. animate latency particles along curves
    this.connections.forEach((conn) => {
      conn.progress += conn.speed;
      if (conn.progress > 1.0) {
        conn.progress = 0;
      }
      
      const newPos = conn.curve.getPointAt(conn.progress);
      conn.particle.position.copy(newPos);
    });

    this.renderer.render(this.scene, this.camera);
  }
}
