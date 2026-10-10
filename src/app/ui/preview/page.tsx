import { notFound } from "next/navigation";
import { OmnichannelPreview } from "@/features/ui-kit/components/omnichannel-preview";

export default function PreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <OmnichannelPreview />;
}
