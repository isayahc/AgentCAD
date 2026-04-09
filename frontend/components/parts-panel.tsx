"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  ChevronRight,
  ChevronDown,
  Settings2,
  Play,
  Pause,
  RotateCcw,
  Link,
  Unlink,
  Trash2,
  Plus,
} from "lucide-react";
import {
  type JointDefinition,
  type PartData,
  type RotationAxis,
} from "@/lib/animation-types";
import * as THREE from "three";

interface PartsPanelProps {
  parts: PartData[];
  joints: JointDefinition[];
  selectedPartId: string | null;
  onSelectPart: (partId: string | null) => void;
  onAddJoint: (joint: JointDefinition) => void;
  onUpdateJoint: (jointId: string, updates: Partial<JointDefinition>) => void;
  onRemoveJoint: (jointId: string) => void;
  onResetAllJoints: () => void;
}

export function PartsPanel({
  parts,
  joints,
  selectedPartId,
  onSelectPart,
  onAddJoint,
  onUpdateJoint,
  onRemoveJoint,
  onResetAllJoints,
}: PartsPanelProps) {
  const [expandedParts, setExpandedParts] = useState(true);
  const [expandedJoints, setExpandedJoints] = useState(true);
  const [configuringPartId, setConfiguringPartId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const selectedPart = parts.find((p) => p.id === selectedPartId);
  const partJoint = joints.find((j) => j.partId === selectedPartId);

  const handleAddJoint = () => {
    if (!selectedPart) return;

    const newJoint: JointDefinition = {
      id: `joint-${Date.now()}`,
      partId: selectedPart.id,
      partName: selectedPart.name,
      axis: "y",
      pivot: selectedPart.center.clone(),
      minAngle: -180,
      maxAngle: 180,
      currentAngle: 0,
      parentJointId: null,
    };

    onAddJoint(newJoint);
    setConfiguringPartId(selectedPart.id);
  };

  const handleAxisChange = (jointId: string, axis: RotationAxis) => {
    onUpdateJoint(jointId, { axis });
  };

  const handleAngleChange = (jointId: string, angle: number) => {
    onUpdateJoint(jointId, { currentAngle: angle });
  };

  const handleMinAngleChange = (jointId: string, value: string) => {
    const angle = parseFloat(value);
    if (!isNaN(angle)) {
      onUpdateJoint(jointId, { minAngle: angle });
    }
  };

  const handleMaxAngleChange = (jointId: string, value: string) => {
    const angle = parseFloat(value);
    if (!isNaN(angle)) {
      onUpdateJoint(jointId, { maxAngle: angle });
    }
  };

  const handleParentChange = (jointId: string, parentId: string | null) => {
    onUpdateJoint(jointId, { parentJointId: parentId });
  };

  const handlePivotChange = (
    jointId: string,
    component: "x" | "y" | "z",
    value: string
  ) => {
    const joint = joints.find((j) => j.id === jointId);
    if (!joint) return;

    const newValue = parseFloat(value);
    if (isNaN(newValue)) return;

    const newPivot = joint.pivot.clone();
    newPivot[component] = newValue;
    onUpdateJoint(jointId, { pivot: newPivot });
  };

  return (
    <Card className="absolute left-4 top-16 w-80 max-h-[calc(100vh-120px)] bg-card/95 backdrop-blur overflow-hidden flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Settings2 className="size-4" />
          Animation Setup
        </CardTitle>
      </CardHeader>

      <CardContent className="p-0 flex-1 overflow-hidden flex flex-col">
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {/* Parts List */}
            <div>
              <button
                className="flex items-center gap-1 text-sm font-medium text-foreground hover:text-primary transition-colors w-full"
                onClick={() => setExpandedParts(!expandedParts)}
              >
                {expandedParts ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
                Parts ({parts.length})
              </button>

              {expandedParts && (
                <div className="mt-2 space-y-1">
                  {parts.map((part) => {
                    const hasJoint = joints.some((j) => j.partId === part.id);
                    return (
                      <button
                        key={part.id}
                        className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-sm transition-colors ${
                          selectedPartId === part.id
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-muted text-foreground"
                        }`}
                        onClick={() => onSelectPart(part.id)}
                      >
                        <span className="truncate">{part.name}</span>
                        {hasJoint && (
                          <Link className="size-3 flex-shrink-0 ml-2 opacity-60" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Selected Part Actions */}
            {selectedPart && !partJoint && (
              <div className="p-3 rounded-lg border border-border bg-muted/50">
                <p className="text-xs text-muted-foreground mb-2">
                  Selected: {selectedPart.name}
                </p>
                <Button size="sm" className="w-full" onClick={handleAddJoint}>
                  <Plus className="size-3 mr-1" />
                  Add Joint
                </Button>
              </div>
            )}

            {/* Joints List */}
            <div>
              <button
                className="flex items-center gap-1 text-sm font-medium text-foreground hover:text-primary transition-colors w-full"
                onClick={() => setExpandedJoints(!expandedJoints)}
              >
                {expandedJoints ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
                Joints ({joints.length})
              </button>

              {expandedJoints && joints.length > 0 && (
                <div className="mt-2 space-y-3">
                  {joints.map((joint) => (
                    <div
                      key={joint.id}
                      className="p-3 rounded-lg border border-border bg-background space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground truncate flex-1">
                          {joint.partName}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 flex-shrink-0"
                          onClick={() => onRemoveJoint(joint.id)}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>

                      {/* Angle Slider */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Angle</Label>
                          <span className="text-xs font-mono text-muted-foreground">
                            {joint.currentAngle.toFixed(1)}°
                          </span>
                        </div>
                        <Slider
                          value={[joint.currentAngle]}
                          min={joint.minAngle}
                          max={joint.maxAngle}
                          step={1}
                          onValueChange={([value]) =>
                            handleAngleChange(joint.id, value)
                          }
                        />
                      </div>

                      {/* Axis Selection */}
                      <div className="space-y-1">
                        <Label className="text-xs">Rotation Axis</Label>
                        <Select
                          value={joint.axis}
                          onValueChange={(value) =>
                            handleAxisChange(joint.id, value as RotationAxis)
                          }
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="x">X Axis (Red)</SelectItem>
                            <SelectItem value="y">Y Axis (Green)</SelectItem>
                            <SelectItem value="z">Z Axis (Blue)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Parent Joint (Kinematic Chain) */}
                      <div className="space-y-1">
                        <Label className="text-xs">Parent Joint</Label>
                        <Select
                          value={joint.parentJointId || "none"}
                          onValueChange={(value) =>
                            handleParentChange(
                              joint.id,
                              value === "none" ? null : value
                            )
                          }
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder="None (root)" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None (root)</SelectItem>
                            {joints
                              .filter((j) => j.id !== joint.id)
                              .map((j) => (
                                <SelectItem key={j.id} value={j.id}>
                                  {j.partName}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Angle Limits */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Min Angle</Label>
                          <Input
                            type="number"
                            value={joint.minAngle}
                            onChange={(e) =>
                              handleMinAngleChange(joint.id, e.target.value)
                            }
                            className="h-8"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Max Angle</Label>
                          <Input
                            type="number"
                            value={joint.maxAngle}
                            onChange={(e) =>
                              handleMaxAngleChange(joint.id, e.target.value)
                            }
                            className="h-8"
                          />
                        </div>
                      </div>

                      {/* Pivot Point */}
                      <div className="space-y-1">
                        <Label className="text-xs">Pivot Point</Label>
                        <div className="grid grid-cols-3 gap-1">
                          <Input
                            type="number"
                            step="0.1"
                            value={joint.pivot.x.toFixed(2)}
                            onChange={(e) =>
                              handlePivotChange(joint.id, "x", e.target.value)
                            }
                            className="h-7 text-xs"
                            placeholder="X"
                          />
                          <Input
                            type="number"
                            step="0.1"
                            value={joint.pivot.y.toFixed(2)}
                            onChange={(e) =>
                              handlePivotChange(joint.id, "y", e.target.value)
                            }
                            className="h-7 text-xs"
                            placeholder="Y"
                          />
                          <Input
                            type="number"
                            step="0.1"
                            value={joint.pivot.z.toFixed(2)}
                            onChange={(e) =>
                              handlePivotChange(joint.id, "z", e.target.value)
                            }
                            className="h-7 text-xs"
                            placeholder="Z"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {expandedJoints && joints.length === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Select a part and click "Add Joint" to create an articulation
                  point.
                </p>
              )}
            </div>
          </div>
        </ScrollArea>

        {/* Footer Actions */}
        {joints.length > 0 && (
          <div className="p-4 border-t border-border flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={onResetAllJoints}
            >
              <RotateCcw className="size-3 mr-1" />
              Reset All Angles
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
