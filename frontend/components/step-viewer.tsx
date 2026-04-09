"use client";

import { useRef, useState, useCallback, Suspense, useEffect, useMemo } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import {
  OrbitControls,
  Environment,
  Center,
  Grid,
  Html,
} from "@react-three/drei";
import * as THREE from "three";
import {
  loadStepFile,
  type StepLoaderResult,
  type PartData,
} from "@/lib/step-loader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Upload, RotateCcw, Maximize2, Cog } from "lucide-react";
import { PartsPanel } from "@/components/parts-panel";
import { ChatPanel } from "@/components/chat-panel";
import {
  type JointDefinition,
  degreesToRadians,
  getAxisVector,
} from "@/lib/animation-types";

// Build kinematic chain order (parent joints first)
function getJointOrder(joints: JointDefinition[]): JointDefinition[] {
  const ordered: JointDefinition[] = [];
  const processed = new Set<string>();

  function addJoint(joint: JointDefinition) {
    if (processed.has(joint.id)) return;

    // First process parent
    if (joint.parentJointId) {
      const parent = joints.find((j) => j.id === joint.parentJointId);
      if (parent && !processed.has(parent.id)) {
        addJoint(parent);
      }
    }

    ordered.push(joint);
    processed.add(joint.id);
  }

  joints.forEach(addJoint);
  return ordered;
}

// Calculate cumulative transform for a joint considering its parent chain
function calculateJointTransform(
  joint: JointDefinition,
  joints: JointDefinition[],
  transformCache: Map<string, THREE.Matrix4>
): THREE.Matrix4 {
  if (transformCache.has(joint.id)) {
    return transformCache.get(joint.id)!;
  }

  const matrix = new THREE.Matrix4();

  // Start with parent transform if any
  if (joint.parentJointId) {
    const parent = joints.find((j) => j.id === joint.parentJointId);
    if (parent) {
      const parentTransform = calculateJointTransform(parent, joints, transformCache);
      matrix.copy(parentTransform);
    }
  }

  // Apply this joint's rotation around its pivot
  const pivot = joint.pivot;
  const axis = getAxisVector(joint.axis);
  const angle = degreesToRadians(joint.currentAngle);

  // Create rotation around pivot
  const toOrigin = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
  const rotation = new THREE.Matrix4().makeRotationAxis(axis, angle);
  const fromOrigin = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z);

  // Apply: translate to origin, rotate, translate back
  matrix.multiply(fromOrigin).multiply(rotation).multiply(toOrigin);

  transformCache.set(joint.id, matrix.clone());
  return matrix;
}

interface AnimatedPartProps {
  part: PartData;
  joints: JointDefinition[];
  isSelected: boolean;
  onSelect: () => void;
  showEdges: boolean;
}

function AnimatedPart({
  part,
  joints,
  isSelected,
  onSelect,
  showEdges,
}: AnimatedPartProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const edgesRef = useRef<THREE.LineSegments>(null);
  const [hovered, setHovered] = useState(false);

  const partJoint = joints.find((j) => j.partId === part.id);

  // Calculate transform for this part
  const transform = useMemo(() => {
    if (!partJoint) return new THREE.Matrix4();

    const transformCache = new Map<string, THREE.Matrix4>();
    return calculateJointTransform(partJoint, joints, transformCache);
  }, [partJoint, joints]);

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.matrix.copy(transform);
      meshRef.current.matrixAutoUpdate = false;
    }
    if (edgesRef.current) {
      edgesRef.current.matrix.copy(transform);
      edgesRef.current.matrixAutoUpdate = false;
    }
  });

  const baseColor = new THREE.Color(part.color[0], part.color[1], part.color[2]);
  const displayColor = isSelected
    ? new THREE.Color(0.2, 0.8, 0.4)
    : hovered
      ? new THREE.Color(0.4, 0.6, 0.9)
      : baseColor;

  return (
    <group>
      <mesh
        ref={meshRef}
        geometry={part.geometry}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "auto";
        }}
        matrixAutoUpdate={false}
      >
        <meshStandardMaterial
          color={displayColor}
          metalness={0.3}
          roughness={0.4}
          side={THREE.DoubleSide}
        />
      </mesh>
      {showEdges && part.edgeGeometry && (
        <lineSegments
          ref={edgesRef}
          geometry={part.edgeGeometry}
          matrixAutoUpdate={false}
        >
          <lineBasicMaterial
            color={isSelected ? "#ffffff" : "#1e1b4b"}
            linewidth={1}
          />
        </lineSegments>
      )}
    </group>
  );
}

interface PivotVisualizerProps {
  joints: JointDefinition[];
  selectedPartId: string | null;
}

function PivotVisualizer({ joints, selectedPartId }: PivotVisualizerProps) {
  const selectedJoint = joints.find((j) => j.partId === selectedPartId);

  if (!selectedJoint) return null;

  const axisColors = {
    x: "#ef4444",
    y: "#22c55e",
    z: "#3b82f6",
  };

  const axis = getAxisVector(selectedJoint.axis);
  const axisEnd = axis.clone().multiplyScalar(2);

  return (
    <group position={selectedJoint.pivot.toArray()}>
      {/* Pivot point sphere */}
      <mesh>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshStandardMaterial
          color={axisColors[selectedJoint.axis]}
          emissive={axisColors[selectedJoint.axis]}
          emissiveIntensity={0.5}
        />
      </mesh>

      {/* Rotation axis line */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={new Float32Array([
              -axisEnd.x,
              -axisEnd.y,
              -axisEnd.z,
              axisEnd.x,
              axisEnd.y,
              axisEnd.z,
            ])}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color={axisColors[selectedJoint.axis]} linewidth={2} />
      </line>
    </group>
  );
}

interface ModelProps {
  stepData: StepLoaderResult;
  joints: JointDefinition[];
  selectedPartId: string | null;
  onSelectPart: (partId: string | null) => void;
  showAnimation: boolean;
}

function Model({
  stepData,
  joints,
  selectedPartId,
  onSelectPart,
  showAnimation,
}: ModelProps) {
  const { camera } = useThree();

  useEffect(() => {
    if (!stepData.geometry.boundingBox) {
      stepData.geometry.computeBoundingBox();
    }

    const boundingBox = stepData.geometry.boundingBox;
    if (!boundingBox) return;

    const center = new THREE.Vector3();
    boundingBox.getCenter(center);

    const size = new THREE.Vector3();
    boundingBox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);

    const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
    const distance = (maxDim / (2 * Math.tan(fov / 2))) * 2;

    camera.position.set(
      center.x + distance * 0.5,
      center.y + distance * 0.5,
      center.z + distance
    );
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  }, [stepData.geometry, camera]);

  // Animation mode - render individual parts
  if (showAnimation && stepData.parts.length > 0) {
    return (
      <Center>
        <group onClick={() => onSelectPart(null)}>
          {stepData.parts.map((part) => (
            <AnimatedPart
              key={part.id}
              part={part}
              joints={joints}
              isSelected={selectedPartId === part.id}
              onSelect={() => onSelectPart(part.id)}
              showEdges={true}
            />
          ))}
          <PivotVisualizer joints={joints} selectedPartId={selectedPartId} />
        </group>
      </Center>
    );
  }

  // Default mode - render combined geometry
  return (
    <Center>
      <group>
        <mesh geometry={stepData.geometry} castShadow receiveShadow>
          <meshStandardMaterial
            color="#6366f1"
            metalness={0.3}
            roughness={0.4}
            side={THREE.DoubleSide}
          />
        </mesh>
        {stepData.edgeGeometry && (
          <lineSegments geometry={stepData.edgeGeometry}>
            <lineBasicMaterial color="#1e1b4b" linewidth={1} />
          </lineSegments>
        )}
      </group>
    </Center>
  );
}

function LoadingIndicator() {
  return (
    <Html center>
      <div className="flex flex-col items-center gap-2 text-center">
        <Spinner className="size-8" />
        <p className="text-sm text-muted-foreground">Loading model...</p>
      </div>
    </Html>
  );
}

interface ViewerCanvasProps {
  stepData: StepLoaderResult | null;
  isLoading: boolean;
  joints: JointDefinition[];
  selectedPartId: string | null;
  onSelectPart: (partId: string | null) => void;
  showAnimation: boolean;
}

function ViewerCanvas({
  stepData,
  isLoading,
  joints,
  selectedPartId,
  onSelectPart,
  showAnimation,
}: ViewerCanvasProps) {
  return (
    <Canvas
      shadows
      camera={{ position: [5, 5, 5], fov: 50 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#f8fafc"]} />

      <ambientLight intensity={0.5} />
      <directionalLight
        position={[10, 10, 5]}
        intensity={1}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <directionalLight position={[-10, -10, -5]} intensity={0.3} />

      <Environment preset="studio" />

      <Grid
        args={[100, 100]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#cbd5e1"
        sectionSize={10}
        sectionThickness={1}
        sectionColor="#94a3b8"
        fadeDistance={100}
        fadeStrength={1}
        position={[0, -0.01, 0]}
      />

      <Suspense fallback={<LoadingIndicator />}>
        {isLoading && <LoadingIndicator />}
        {stepData && (
          <Model
            stepData={stepData}
            joints={joints}
            selectedPartId={selectedPartId}
            onSelectPart={onSelectPart}
            showAnimation={showAnimation}
          />
        )}
      </Suspense>

      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        minDistance={0.1}
        maxDistance={1000}
      />
    </Canvas>
  );
}

export function StepViewer() {
  const [stepData, setStepData] = useState<StepLoaderResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showAnimation, setShowAnimation] = useState(false);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [joints, setJoints] = useState<JointDefinition[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "step" && ext !== "stp") {
      setError("Please upload a .step or .stp file");
      return;
    }

    setIsLoading(true);
    setError(null);
    setFileName(file.name);
    setSelectedPartId(null);
    setJoints([]);
    setShowAnimation(false);

    try {
      const buffer = await file.arrayBuffer();
      const result = await loadStepFile(buffer);
      setStepData(result);
    } catch (err) {
      console.error("[v0] Error loading STEP file:", err);
      setError(err instanceof Error ? err.message : "Failed to load STEP file");
      setStepData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(true);
    },
    []
  );

  const handleDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
    },
    []
  );

  const handleReset = useCallback(() => {
    setStepData(null);
    setFileName(null);
    setError(null);
    setSelectedPartId(null);
    setJoints([]);
    setShowAnimation(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleAddJoint = useCallback((joint: JointDefinition) => {
    setJoints((prev) => [...prev, joint]);
  }, []);

  const handleUpdateJoint = useCallback(
    (jointId: string, updates: Partial<JointDefinition>) => {
      setJoints((prev) =>
        prev.map((j) => (j.id === jointId ? { ...j, ...updates } : j))
      );
    },
    []
  );

  const handleRemoveJoint = useCallback((jointId: string) => {
    setJoints((prev) => {
      // Also update any joints that had this as parent
      return prev
        .filter((j) => j.id !== jointId)
        .map((j) =>
          j.parentJointId === jointId ? { ...j, parentJointId: null } : j
        );
    });
  }, []);

  const handleResetAllJoints = useCallback(() => {
    setJoints((prev) => prev.map((j) => ({ ...j, currentAngle: 0 })));
  }, []);

  return (
    <div className="flex h-screen w-full flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary">
            <Maximize2 className="size-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              STEP File Viewer
            </h1>
            {fileName && (
              <p className="text-sm text-muted-foreground">
                {fileName}
                {stepData && stepData.parts.length > 0 && ` - ${stepData.parts.length} parts`}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".step,.stp"
            onChange={handleFileChange}
            className="hidden"
            id="step-file-input"
          />
          {stepData && stepData.parts.length > 1 && (
            <Button
              variant={showAnimation ? "default" : "outline"}
              size="sm"
              onClick={() => setShowAnimation(!showAnimation)}
            >
              <Cog className="mr-2 size-4" />
              Animate
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mr-2 size-4" />
            Upload
          </Button>
          {stepData && (
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="mr-2 size-4" />
              Reset
            </Button>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="relative flex-1">
        {!stepData && !isLoading ? (
          <div
            className={`absolute inset-0 flex items-center justify-center p-8 transition-colors ${
              isDragging ? "bg-primary/5" : ""
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <Card
              className={`w-full max-w-md cursor-pointer transition-all ${
                isDragging ? "scale-105 border-2 border-primary" : ""
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <CardContent className="flex flex-col items-center gap-4 pt-6">
                <div className="flex size-16 items-center justify-center rounded-full bg-muted">
                  <Upload className="size-8 text-muted-foreground" />
                </div>
                <div className="text-center">
                  <h2 className="text-lg font-semibold text-foreground">
                    Upload STEP File
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Drag and drop a .step or .stp file here, or click to browse
                  </p>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
              </CardContent>
            </Card>
          </div>
        ) : (
          <ViewerCanvas
            stepData={stepData}
            isLoading={isLoading}
            joints={joints}
            selectedPartId={selectedPartId}
            onSelectPart={setSelectedPartId}
            showAnimation={showAnimation}
          />
        )}

        {/* Animation Panel */}
        {showAnimation && stepData && (
          <PartsPanel
            parts={stepData.parts}
            joints={joints}
            selectedPartId={selectedPartId}
            onSelectPart={setSelectedPartId}
            onAddJoint={handleAddJoint}
            onUpdateJoint={handleUpdateJoint}
            onRemoveJoint={handleRemoveJoint}
            onResetAllJoints={handleResetAllJoints}
          />
        )}

        {/* Chat Panel */}
        <ChatPanel />

        {/* Instructions overlay */}
        {stepData && !isLoading && (
          <div className="absolute bottom-4 left-4 max-w-[calc(100%-26rem)] rounded-lg border border-border bg-card/90 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
            <p>
              <span className="font-medium">Controls:</span> Left click + drag
              to rotate | Right click + drag to pan | Scroll to zoom
              {showAnimation && " | Click a part to select it"}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
