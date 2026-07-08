import type { Metadata } from 'next';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import Sidebar from "@/components/layout/Sidebar";
import ErrorModal from "@/components/common/ErrorModal";
import KeyboardShortcuts from "@/components/common/KeyboardShortcuts";
import { APP_NAME } from "@/utils/branding";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: `${APP_NAME} — 사내 문서 기반 RAG 챗봇`,
  icons: {
    icon: [
      { url: "/exaone_logo.png", type: "image/png" }
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="flex h-screen bg-[#F0F4F9] dark:bg-[#1E1F22] overflow-hidden antialiased font-sans text-gray-900 dark:text-gray-100 transition-colors duration-300">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Sidebar />
          <div className="flex-1 flex flex-col relative h-full w-full bg-white dark:bg-[#131314] md:rounded-tl-2xl md:mt-2 shadow-sm border-t border-l border-transparent dark:border-[#2A2B2E] overflow-hidden transition-colors duration-300">
            {children}
          </div>
          <ErrorModal />
          <KeyboardShortcuts />
        </ThemeProvider>
      </body>
    </html>
  );
}
