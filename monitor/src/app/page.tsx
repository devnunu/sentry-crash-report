import { redirect } from "next/navigation";

export default function Home() {
  // 첫 화면 진입 시 /monitor 로 즉시 리다이렉트
  redirect("/monitor");
}