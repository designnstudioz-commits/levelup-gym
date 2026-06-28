"use client";

import { useEffect, useRef, useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { Camera, Loader2, User } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { FullRegistrationData } from "@/lib/validations/registration";
import { formatCnic, formatPhone } from "@/lib/utils";

interface Step1Props {
  form: UseFormReturn<FullRegistrationData>;
}

const REFERRAL_OPTIONS = [
  "Social Media (Instagram/Facebook)",
  "Friend / Family Referral",
  "Walk-in / Signage",
  "Google Search",
  "WhatsApp Group",
  "Other",
];

export function Step1Personal({ form }: Step1Props) {
  const { register, formState: { errors }, setValue, watch } = form;
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  function handleDobChange(e: React.ChangeEvent<HTMLInputElement>) {
    const dob = new Date(e.target.value);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age--;
    }
    setValue("age", age > 0 ? age : undefined);
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await previewAndUploadFile(file);
  }

  async function previewAndUploadFile(file: File) {
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
    await uploadPhoto(file);
  }

  async function uploadPhoto(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/photo", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || json.error) {
        toast.error(json.error ?? "Photo upload failed");
        setPhotoPreview(null);
        setValue("photo_url", undefined);
      } else {
        setValue("photo_url", json.url);
      }
    } catch {
      toast.error("Photo upload failed");
      setPhotoPreview(null);
      setValue("photo_url", undefined);
    } finally {
      setUploading(false);
    }
  }

  function openUploadDialog() {
    uploadRef.current?.click();
  }

  async function openCameraDialog() {
    setCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      setCameraStream(stream);
    } catch (err) {
      toast.error("Unable to access camera. Please allow camera permissions.");
      setCameraOpen(false);
    }
  }

  function closeCameraDialog() {
    setCameraOpen(false);
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
    }
  }

  useEffect(() => {
    if (cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream]);

  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [cameraStream]);

  async function captureFromCamera() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) return;
    const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
    await uploadPhoto(file);
    closeCameraDialog();
  }

  const age = watch("age");
  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="space-y-6">
      {/* Photo upload */}
      <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
        <div className="space-y-4 rounded-3xl border border-[#E4E4DE] bg-[#FEF0E8] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[#1A1A16]">Member Photo</p>
              <p className="text-xs text-[#7A7A72]">Upload or capture a clear face photo.</p>
            </div>
          </div>

          <div className="relative w-full overflow-hidden rounded-3xl border border-[#E4E4DE] bg-white h-56 sm:h-52">
            <div className="absolute inset-0 rounded-3xl overflow-hidden">
              {uploading ? (
                <div className="flex h-full w-full items-center justify-center bg-[#FEF0E8] text-center">
                  <Loader2 className="w-10 h-10 text-[#F06418] animate-spin" />
                </div>
              ) : photoPreview ? (
                <img src={photoPreview} alt="Photo preview" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center text-[#7A7A72]">
                  <User className="w-10 h-10 text-[#F06418]" />
                  <p className="text-sm font-medium text-[#1A1A16]">No photo selected</p>
                  <p className="text-xs">Choose upload or camera.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-3xl border border-[#E4E4DE] bg-white p-4">
          <div>
            <p className="text-sm font-semibold text-[#1A1A16]">Photo Actions</p>
            <p className="text-xs text-[#7A7A72]">Pick a photo from file or camera.</p>
          </div>

          <div className="space-y-3">
            <button
              type="button"
              onClick={openUploadDialog}
              disabled={uploading}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#E4E4DE] bg-[#FEF0E8] px-4 py-3 text-sm font-semibold text-[#1A1A16] transition-colors hover:border-[#F06418] hover:bg-white disabled:opacity-70"
            >
              <User className="w-4 h-4 text-[#F06418]" />
              Upload Photo
            </button>
            <button
              type="button"
              onClick={openCameraDialog}
              disabled={uploading}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#E4E4DE] bg-white px-4 py-3 text-sm font-semibold text-[#1A1A16] transition-colors hover:border-[#F06418] hover:bg-[#FEF0E8] disabled:opacity-70"
            >
              <Camera className="w-4 h-4 text-[#F06418]" />
              Use Camera
            </button>
            {photoPreview && (
              <button
                type="button"
                onClick={() => {
                  setPhotoPreview(null);
                  setValue("photo_url", undefined);
                }}
                className="flex w-full items-center justify-center rounded-xl border border-[#E4E4DE] bg-white px-4 py-3 text-sm font-semibold text-[#1A1A16] transition-colors hover:border-[#F06418] hover:bg-[#FEF0E8]"
              >
                Remove Photo
              </button>
            )}
          </div>
        </div>

        <input
          ref={uploadRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePhotoChange}
        />
      </div>
      {cameraOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={closeCameraDialog} />
          <div className="relative w-full max-w-3xl rounded-3xl border border-[#E4E4DE] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#E4E4DE] px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-[#1A1A16]">Capture Member Photo</h2>
                <p className="text-sm text-[#7A7A72]">Use your browser camera and capture a clear face image.</p>
              </div>
              <button
                onClick={closeCameraDialog}
                className="text-[#7A7A72] hover:text-[#1A1A16] hover:bg-gray-100 p-2 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr] p-5">
              <div className="space-y-4">
                <div className="aspect-video w-full overflow-hidden rounded-3xl bg-black">
                  <video
                    ref={videoRef}
                    className="h-full w-full object-cover"
                    autoPlay
                    muted
                    playsInline
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={closeCameraDialog}
                    className="w-full rounded-lg border border-[#E4E4DE] bg-white px-4 py-2 text-sm font-semibold text-[#1A1A16] transition-colors hover:border-[#F06418] hover:bg-[#FEF0E8]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={captureFromCamera}
                    className="w-full rounded-lg bg-[#F06418] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#C04E10]"
                  >
                    Capture
                  </button>
                </div>
              </div>
              <div className="space-y-4 rounded-3xl border border-[#E4E4DE] bg-[#FAFAF8] p-4">
                <p className="text-sm font-semibold text-[#1A1A16]">Camera tips</p>
                <ul className="space-y-2 text-sm text-[#4A4A44]">
                  <li>• Face the camera straight on</li>
                  <li>• Keep a neutral background</li>
                  <li>• Ensure good lighting</li>
                  <li>• Avoid hats and sunglasses</li>
                </ul>
              </div>
            </div>
            <canvas ref={canvasRef} className="hidden" />
          </div>
        </div>
      )}

      {/* Personal info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <Input
            label="Full Name"
            required
            placeholder="e.g. Muhammad Arsal"
            error={errors.full_name?.message}
            {...register("full_name")}
          />
        </div>
        <div className="sm:col-span-2">
          <Input
            label="Father / Husband Name"
            placeholder="e.g. Muhammad Imran"
            {...register("secondary_name")}
          />
        </div>
        <div>
          <Input
            label="Date of Birth"
            type="date"
            min="1940-01-01"
            max={today}
            error={errors.dob?.message}
            {...register("dob", { onChange: handleDobChange })}
          />
        </div>
        <div>
          <Input
            label="Age"
            type="number"
            placeholder="Auto-calculated"
            value={age ?? ""}
            readOnly
            className="bg-gray-50 text-[#7A7A72]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#1A1A16] mb-1.5">
            Gender <span className="text-[#F06418]">*</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {["Male", "Female"].map((g) => {
              const selected = watch("gender") === g;
              return (
                <button key={g} type="button"
                  onClick={() => setValue("gender", g as any, { shouldValidate: true })}
                  className={`py-2.5 rounded-lg border-2 text-sm font-bold transition-all ${
                    selected ? "bg-[#F06418] border-[#F06418] text-white" : "bg-white border-[#E4E4DE] text-[#4A4A44] hover:border-[#F06418] hover:text-[#F06418]"
                  }`}>
                  {g === "Male" ? "♂ Male" : "♀ Female"}
                </button>
              );
            })}
          </div>
          {errors.gender && <p className="text-xs text-red-600 mt-1">{errors.gender.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-[#1A1A16] mb-1.5">Marital Status</label>
          <div className="grid grid-cols-2 gap-2">
            {["Single", "Married"].map((s) => {
              const selected = watch("marital_status") === s;
              return (
                <button key={s} type="button"
                  onClick={() => setValue("marital_status", s as any)}
                  className={`py-2.5 rounded-lg border-2 text-sm font-bold transition-all ${
                    selected ? "bg-[#F06418] border-[#F06418] text-white" : "bg-white border-[#E4E4DE] text-[#4A4A44] hover:border-[#F06418] hover:text-[#F06418]"
                  }`}>
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Contact */}
      <div>
        <h3 className="text-sm font-semibold text-[#4A4A44] uppercase tracking-wide mb-3">
          Contact Information
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Phone Number"
            required
            type="tel"
            placeholder="0300-0000000"
            error={errors.phone?.message}
            value={watch("phone") ?? ""}
            onChange={(e) => setValue("phone", formatPhone(e.target.value), { shouldValidate: true })}
          />
          <Input
            label="WhatsApp Number"
            type="tel"
            placeholder="Same as phone"
            error={errors.whatsapp?.message}
            value={watch("whatsapp") ?? ""}
            onChange={(e) => setValue("whatsapp", formatPhone(e.target.value))}
          />
          <Input
            label="Email Address"
            type="email"
            placeholder="optional@email.com"
            error={errors.email?.message}
            {...register("email")}
          />
          <Input
            label="CNIC"
            placeholder="XXXXX-XXXXXXX-X"
            value={watch("cnic") ?? ""}
            onChange={(e) => setValue("cnic", formatCnic(e.target.value), { shouldValidate: true })}
            error={errors.cnic?.message}
          />
          <div className="sm:col-span-2">
            <Input
              label="Home Address"
              placeholder="Street, Area, City"
              {...register("address")}
            />
          </div>
        </div>
      </div>

      {/* Referral */}
      <div>
        <h3 className="text-sm font-semibold text-[#4A4A44] uppercase tracking-wide mb-3">
          How did you find us?
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Referral Source"
            placeholder="Select source"
            {...register("referral_source")}
          >
            {REFERRAL_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </Select>
          <Input
            label="Referred by (Name)"
            placeholder="Name of person who referred you"
            {...register("referred_by")}
          />
        </div>
      </div>
    </div>
  );
}
