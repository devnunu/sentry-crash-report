import { redirect } from "next/navigation";

export default function Home() {
  // 메인 페이지 접근 시 모니터링 페이지로 리다이렉트
  redirect("/monitor");
}