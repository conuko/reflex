import type { Metadata } from "next";

import { notFound } from "next/navigation";

import { EvalItemView } from "@/components/eval/eval-item-view";
import { db } from "@/lib/db";
import { EVAL_PARTS, evalItemDetail } from "@/lib/reads/eval";

export const metadata: Metadata = { title: "Eval item" };

export default async function EvalItemPage({ params }: PageProps<"/eval/[part]/[item]">) {
  const { part: partParam, item } = await params;
  const part = EVAL_PARTS.find((each) => each === partParam);
  if (!part) notFound();
  const detail = await evalItemDetail(db(), part, decodeURIComponent(item));
  if (!detail) notFound();
  return (
    <div className="mx-auto max-w-6xl p-6">
      <EvalItemView detail={detail} />
    </div>
  );
}
