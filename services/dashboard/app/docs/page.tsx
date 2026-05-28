import { redirect } from "next/navigation";
import { DOCS } from "@/lib/docs";

export default function DocsIndex() {
  redirect(`/docs/${DOCS[0].slug}`);
}
