"use client";

import { Power } from "lucide-react";
import { PictureSectionToggle } from "@/components/admin/FeatureToggles";

export default function PictureFeaturePanel() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-fg sm:text-3xl">
          <Power className="h-6 w-6 text-blue-500" />
          ছবি সেটিংস
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-fg-muted">
          পুরো ওয়েবসাইটে ছবি সেকশন দেখাবেন না লুকাবেন তা এখান থেকেই নিয়ন্ত্রণ করুন।
        </p>
      </header>

      <PictureSectionToggle />
    </div>
  );
}
