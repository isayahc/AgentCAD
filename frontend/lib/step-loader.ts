import * as THREE from "three";

// Type definitions for occt-import-js (based on official docs)
interface OcctBrepFace {
  first: number;  // First triangle index
  last: number;   // Last triangle index
  color: [number, number, number] | null;
}

interface OcctMesh {
  name: string;
  color?: [number, number, number];
  brep_faces: OcctBrepFace[];
  attributes: {
    position: {
      array: number[];
    };
    normal?: {
      array: number[];
    };
  };
  index: {
    array: number[];
  };
}

interface OcctImportJsResult {
  success: boolean;
  root: {
    name: string;
    meshes: number[];
    children: unknown[];
  };
  meshes: OcctMesh[];
}

interface OcctModule {
  ReadStepFile: (
    fileBuffer: Uint8Array,
    params: null | Record<string, unknown>
  ) => OcctImportJsResult;
}

let occtModule: OcctModule | null = null;
let loadingPromise: Promise<OcctModule> | null = null;

export async function initOcct(): Promise<OcctModule> {
  if (occtModule) return occtModule;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    // Dynamic import of occt-import-js
    const occtImport = await import("occt-import-js");

    // Initialize with locateFile to fetch WASM from CDN
    const occt = await occtImport.default({
      locateFile: (file: string) => {
        // Use unpkg CDN for the WASM file
        return `https://unpkg.com/occt-import-js@0.0.23/dist/${file}`;
      },
    });
    occtModule = occt;
    return occt;
  })();

  return loadingPromise;
}

// Individual face data for selection
export interface FaceData {
  id: string;
  name: string;
  geometry: THREE.BufferGeometry;
  edgeGeometry: THREE.BufferGeometry | null;
  color: [number, number, number];
  meshIndex: number;
  faceIndex: number;
}

// Part data for animation
export interface PartData {
  id: string;
  name: string;
  meshIndex: number;
  geometry: THREE.BufferGeometry;
  edgeGeometry: THREE.BufferGeometry | null;
  color: [number, number, number];
  center: THREE.Vector3;
  boundingBox: THREE.Box3;
}

export interface StepLoaderResult {
  geometry: THREE.BufferGeometry;
  edgeGeometry: THREE.BufferGeometry | null;
  faces: FaceData[];
  parts: PartData[];
}

export async function loadStepFile(
  fileContent: ArrayBuffer
): Promise<StepLoaderResult> {
  const occt = await initOcct();

  const fileBuffer = new Uint8Array(fileContent);
  const result = occt.ReadStepFile(fileBuffer, null);

  if (!result.success) {
    throw new Error("Failed to parse STEP file");
  }

  if (!result.meshes || result.meshes.length === 0) {
    throw new Error("No meshes found in STEP file");
  }

  // Build combined geometry from all meshes
  const allPositions: number[] = [];
  const allNormals: number[] = [];
  const allIndices: number[] = [];
  const faces: FaceData[] = [];
  const parts: PartData[] = [];
  
  let vertexOffset = 0;
  let faceId = 0;

  for (let meshIdx = 0; meshIdx < result.meshes.length; meshIdx++) {
    const mesh = result.meshes[meshIdx];
    const meshColor: [number, number, number] = mesh.color || [0.4, 0.4, 0.8];
    
    const positions = mesh.attributes?.position?.array;
    const normals = mesh.attributes?.normal?.array;
    const indices = mesh.index?.array;

    if (!positions || !indices) {
      continue;
    }

    // Create part data for animation
    const partGeometry = new THREE.BufferGeometry();
    partGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );
    if (normals) {
      partGeometry.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(normals, 3)
      );
    }
    partGeometry.setIndex(indices);
    partGeometry.computeBoundingSphere();
    partGeometry.computeBoundingBox();

    const partCenter = new THREE.Vector3();
    const partBoundingBox = partGeometry.boundingBox || new THREE.Box3();
    partBoundingBox.getCenter(partCenter);

    let partEdgeGeometry: THREE.BufferGeometry | null = null;
    try {
      partEdgeGeometry = new THREE.EdgesGeometry(partGeometry, 15);
    } catch {
      // Edge geometry creation failed
    }

    parts.push({
      id: `part-${meshIdx}`,
      name: mesh.name || `Part ${meshIdx + 1}`,
      meshIndex: meshIdx,
      geometry: partGeometry,
      edgeGeometry: partEdgeGeometry,
      color: meshColor,
      center: partCenter,
      boundingBox: partBoundingBox,
    });

    // Add positions to combined geometry
    for (let i = 0; i < positions.length; i++) {
      allPositions.push(positions[i]);
    }

    // Add normals if available
    if (normals) {
      for (let i = 0; i < normals.length; i++) {
        allNormals.push(normals[i]);
      }
    }

    // Add indices with offset
    for (let i = 0; i < indices.length; i++) {
      allIndices.push(indices[i] + vertexOffset);
    }

    // Process brep_faces if available
    if (mesh.brep_faces && mesh.brep_faces.length > 0) {
      for (let faceIdx = 0; faceIdx < mesh.brep_faces.length; faceIdx++) {
        const brepFace = mesh.brep_faces[faceIdx];
        const faceColor: [number, number, number] = brepFace.color || meshColor;

        // brep_faces use first/last as triangle indices (multiply by 3 for index array position)
        const firstTriIndex = brepFace.first * 3;
        const lastTriIndex = (brepFace.last + 1) * 3; // last is inclusive, so add 1

        // Extract face geometry
        const faceGeometry = extractFaceGeometry(
          positions,
          normals || null,
          indices,
          firstTriIndex,
          lastTriIndex
        );

        if (faceGeometry) {
          // Create edge geometry for this face
          let faceEdgeGeometry: THREE.BufferGeometry | null = null;
          try {
            faceEdgeGeometry = new THREE.EdgesGeometry(faceGeometry, 15);
          } catch {
            // Edge geometry creation failed
          }

          faces.push({
            id: `face-${faceId}`,
            name: `${mesh.name || `Part ${meshIdx + 1}`} - Face ${faceIdx + 1}`,
            geometry: faceGeometry,
            edgeGeometry: faceEdgeGeometry,
            color: faceColor,
            meshIndex: meshIdx,
            faceIndex: faceIdx,
          });
          faceId++;
        }
      }
    } else {
      // No brep_faces - treat entire mesh as one selectable face
      const meshGeometry = new THREE.BufferGeometry();
      meshGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3)
      );
      if (normals) {
        meshGeometry.setAttribute(
          "normal",
          new THREE.Float32BufferAttribute(normals, 3)
        );
      }
      meshGeometry.setIndex(indices);
      meshGeometry.computeBoundingSphere();

      let meshEdgeGeometry: THREE.BufferGeometry | null = null;
      try {
        meshEdgeGeometry = new THREE.EdgesGeometry(meshGeometry, 15);
      } catch {
        // Edge geometry creation failed
      }

      faces.push({
        id: `face-${faceId}`,
        name: mesh.name || `Part ${meshIdx + 1}`,
        geometry: meshGeometry,
        edgeGeometry: meshEdgeGeometry,
        color: meshColor,
        meshIndex: meshIdx,
        faceIndex: 0,
      });
      faceId++;
    }

    vertexOffset += positions.length / 3;
  }

  if (allPositions.length === 0) {
    throw new Error("No geometry found in STEP file");
  }

  // Create combined Three.js geometry
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(allPositions, 3)
  );

  if (allNormals.length > 0) {
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(allNormals, 3)
    );
  }

  if (allIndices.length > 0) {
    geometry.setIndex(allIndices);
  }

  // Compute vertex normals if not provided
  if (allNormals.length === 0) {
    geometry.computeVertexNormals();
  }

  // Compute bounding sphere for proper centering
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

  // Create edge geometry for wireframe overlay
  let edgeGeometry: THREE.BufferGeometry | null = null;
  try {
    edgeGeometry = new THREE.EdgesGeometry(geometry, 15);
  } catch {
    // Edge geometry creation failed, continue without it
  }

  return { geometry, edgeGeometry, faces, parts };
}

function extractFaceGeometry(
  positions: number[],
  normals: number[] | null,
  indices: number[],
  firstIndex: number,
  lastIndex: number
): THREE.BufferGeometry | null {
  if (firstIndex >= lastIndex || firstIndex >= indices.length) {
    return null;
  }

  const facePositions: number[] = [];
  const faceNormals: number[] = [];
  const vertexMap = new Map<number, number>();
  const faceIndices: number[] = [];

  // Extract triangles for this face
  const endIndex = Math.min(lastIndex, indices.length);
  
  for (let i = firstIndex; i < endIndex; i++) {
    const vertexIndex = indices[i];

    if (!vertexMap.has(vertexIndex)) {
      const newIndex = facePositions.length / 3;
      vertexMap.set(vertexIndex, newIndex);

      // Copy position
      const posOffset = vertexIndex * 3;
      facePositions.push(
        positions[posOffset],
        positions[posOffset + 1],
        positions[posOffset + 2]
      );

      // Copy normal if available
      if (normals) {
        faceNormals.push(
          normals[posOffset],
          normals[posOffset + 1],
          normals[posOffset + 2]
        );
      }
    }

    faceIndices.push(vertexMap.get(vertexIndex)!);
  }

  if (facePositions.length === 0) {
    return null;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(facePositions, 3)
  );

  if (faceNormals.length > 0) {
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(faceNormals, 3)
    );
  }

  if (faceIndices.length > 0) {
    geometry.setIndex(faceIndices);
  }

  if (faceNormals.length === 0) {
    geometry.computeVertexNormals();
  }

  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

  return geometry;
}
