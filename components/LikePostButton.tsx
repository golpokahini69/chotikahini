"use client";

import { useState, useEffect } from "react";
import { Heart } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export function LikePostButton({ postSlug }: { postSlug: string }) {
  const { user } = useAuth();
  // Only a count and "did I like this" are rendered. The endpoint used to
  // return every liker's user_id, which made the payload grow with a
  // story's popularity for no visual benefit.
  const [count, setCount] = useState(0);
  const [hasLiked, setHasLiked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isLiking, setIsLiking] = useState(false);

  useEffect(() => {
    async function fetchLikes() {
      try {
        // Anonymous readers take the shared, edge-cached answer (`liked` is
        // always false for them, so it is identical for everyone). A logged-in
        // reader adds `me=1`, which the server answers privately — and which
        // re-fires once auth resolves, so the correct liked-state replaces it.
        const wantsState = !!user;
        const res = await fetch(
          `/api/likes?slug=${encodeURIComponent(postSlug)}${wantsState ? "&me=1" : ""}`,
        );
        if (res.ok) {
          const data = await res.json();
          setCount(typeof data.count === "number" ? data.count : 0);
          setHasLiked(!!data.liked);
        }
      } catch (err) {
        console.error("Failed to fetch likes", err);
      } finally {
        setLoading(false);
      }
    }
    fetchLikes();
  }, [postSlug, user]);

  const toggleLike = async () => {
    if (!user) {
      alert("পছন্দ করতে হলে আপনাকে লগিন করতে হবে।");
      return;
    }
    if (isLiking) return;

    setIsLiking(true);
    const action = hasLiked ? "unlike" : "like";

    // Optimistic UI update
    setHasLiked(action === "like");
    setCount((prev) => Math.max(0, prev + (action === "like" ? 1 : -1)));

    try {
      const res = await fetch("/api/likes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: postSlug, action })
      });
      if (!res.ok) {
        throw new Error("Failed");
      }
    } catch {
      // Revert optimistic update
      alert("দুঃখিত, কোনো একটি সমস্যা হয়েছে।");
      setHasLiked(action !== "like");
      setCount((prev) => Math.max(0, prev + (action === "like" ? -1 : 1)));
    } finally {
      setIsLiking(false);
    }
  };

  if (loading) {
    return (
      <button disabled className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-400">
        <Heart className="w-4 h-4" />
        ...
      </button>
    );
  }

  return (
    <button
      onClick={toggleLike}
      disabled={isLiking}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
        hasLiked 
          ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40"
          : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
      }`}
    >
      <Heart className={`w-4 h-4 ${hasLiked ? "fill-current" : ""}`} />
      <span>{count > 0 ? count : "পছন্দ করুন"}</span>
    </button>
  );
}
