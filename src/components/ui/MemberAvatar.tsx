"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ImageOff, Upload } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/contexts/CurrentUserContext";
import { cn } from "@/lib/utils";

const REUPLOAD_ROLES = ["owner", "manager", "receptionist"];

interface MemberAvatarProps {
  photoUrl?: string | null;
  name: string;
  membershipNo?: string | null;
  /** Diameter in pixels. */
  size: number;
  className?: string;
  rounded?: boolean;
  /** Overrides the default initial-letter placeholder (e.g. a <User /> icon). */
  fallback?: React.ReactNode;
  /** members.id — required for the "Re-upload Photo" recovery action. Omit
   *  for non-member rows (e.g. pending registration submissions), which
   *  simply won't offer that action. */
  memberId?: string;
}

/**
 * A member/profile avatar that's also a click/tap-to-enlarge lightbox
 * (spec: receptionist should be able to visually confirm a member without
 * leaving the page). Renders as a <span role="button"> rather than a real
 * <button> because several call sites already nest this inside their own
 * clickable row/card — a real <button> would produce invalid nested-button
 * HTML there.
 *
 * Uses next/image (not a plain <img>) so a 56px list-row avatar actually
 * downloads a ~56px-scale derivative instead of the full ~1024px stored
 * profile photo — Next's built-in image optimizer (same Vercel
 * infrastructure that already serves this app) generates and edge-caches
 * that derivative on demand. `photoUrl` is always the persisted
 * member-photos URL from this project's own Supabase Storage (never a
 * transient blob: preview URL — those are rendered separately, see the
 * dashboard member-photo edit modal), which is the exact host already
 * allow-listed in next.config.ts's images.remotePatterns.
 *
 * BROKEN-PHOTO HANDLING: a `photoUrl` that 404s (member row still has a
 * URL, but the underlying storage object is gone) is treated as a distinct
 * state from "no photo" — never silently swapped to the plain-initial
 * placeholder, and never auto-cleared from the member record. Only an
 * explicit "Re-upload Photo" action (owner/manager/receptionist, same role
 * set as the existing "front-desk edit members" RLS policy) writes a new
 * photo_url, and only after a real upload succeeds.
 */
export function MemberAvatar({ photoUrl, name, membershipNo, size, className, rounded = true, fallback, memberId }: MemberAvatarProps) {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(photoUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentUser = useCurrentUser();
  const canReupload = !!memberId && !!currentUser?.role && REUPLOAD_ROLES.includes(currentUser.role);
  const initial = name?.trim()?.charAt(0)?.toUpperCase() || "?";

  // photoUrl can change between renders (e.g. a list refetch) — if it does,
  // treat it as a fresh URL, not still-broken from a previous one. Compare
  // against the SAME null-normalized value that's stored in state: an absent
  // prop arrives as undefined (e.g. `r.member?.photo_url` on a staff row),
  // which would otherwise never equal the stored null and re-set state on
  // every render until React aborts with "Too many re-renders".
  const nextUrl = photoUrl ?? null;
  if (nextUrl !== currentUrl && !uploading) {
    setCurrentUrl(nextUrl);
    if (broken) setBroken(false);
  }

  function handleActivate(e: React.SyntheticEvent) {
    e.stopPropagation();
    if (currentUrl) setOpen(true);
  }

  async function handleReuploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !memberId) return;

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/photo", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || json.error) {
        toast.error(json.error ?? "Upload failed");
        return;
      }

      const supabase = createClient();
      const { error } = await supabase.from("members").update({ photo_url: json.url }).eq("id", memberId);
      if (error) {
        toast.error("Uploaded but could not save to the member record");
        return;
      }

      setCurrentUrl(json.url);
      setBroken(false);
      toast.success("Photo updated");
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <span
        role="button"
        tabIndex={currentUrl ? 0 : -1}
        aria-label={currentUrl ? (broken ? `${name}'s photo needs re-upload` : `View ${name}'s photo`) : undefined}
        onClick={handleActivate}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleActivate(e);
          }
        }}
        className={cn(
          "relative bg-[#FEF0E8] flex items-center justify-center flex-shrink-0 overflow-hidden select-none",
          rounded && "rounded-full",
          currentUrl && "cursor-zoom-in",
          className
        )}
        style={{ width: size, height: size }}
      >
        {currentUrl && !broken ? (
          <Image src={currentUrl} alt="" fill sizes={`${size}px`} className="object-cover" onError={() => setBroken(true)} />
        ) : currentUrl && broken ? (
          <ImageOff className="text-[#7A7A72]" style={{ width: size * 0.4, height: size * 0.4 }} />
        ) : fallback ? (
          fallback
        ) : (
          <span className="text-[#F06418] font-bold" style={{ fontSize: Math.max(10, size * 0.4) }}>
            {initial}
          </span>
        )}
      </span>

      {currentUrl && (
        <Modal open={open} onClose={() => setOpen(false)} title={name} size="sm">
          <div className="flex flex-col items-center gap-3">
            {!broken ? (
              <div className="relative w-full max-w-[500px] h-[min(70vh,500px)] rounded-lg overflow-hidden bg-[#F8F8F6]">
                <Image src={currentUrl} alt={name} fill sizes="500px" className="object-contain" onError={() => setBroken(true)} />
              </div>
            ) : (
              <div className="w-full max-w-[500px] py-10 flex flex-col items-center gap-2 rounded-lg bg-[#F8F8F6]">
                <ImageOff className="w-10 h-10 text-[#7A7A72]" />
                <p className="text-sm font-semibold text-[#1A1A16]">Photo needs re-upload</p>
                <p className="text-xs text-[#7A7A72] text-center max-w-xs">
                  This member&apos;s photo file is missing from storage. The member record itself is unaffected.
                </p>
                {canReupload && (
                  <>
                    <Button
                      variant="secondary"
                      className="mt-2"
                      onClick={() => fileInputRef.current?.click()}
                      loading={uploading}
                    >
                      <Upload className="w-4 h-4" />
                      {uploading ? "Uploading…" : "Re-upload Photo"}
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleReuploadFile}
                    />
                  </>
                )}
              </div>
            )}
            {membershipNo && <p className="text-sm text-[#7A7A72] font-medium">{membershipNo}</p>}
          </div>
        </Modal>
      )}
    </>
  );
}
