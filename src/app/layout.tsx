import type { Metadata } from "next";
import { Big_Shoulders, Kalam, Martian_Mono, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

const shoulders = Big_Shoulders({
  variable: "--font-shoulders",
  subsets: ["latin"],
  weight: ["700", "800"],
});

const schibsted = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
});

const martian = Martian_Mono({
  variable: "--font-martian",
  subsets: ["latin"],
});

const kalam = Kalam({
  variable: "--font-kalam",
  subsets: ["latin"],
  weight: ["400"],
});

export const metadata: Metadata = {
  title: "RunNotes",
  description: "A lab notebook for ML experiments that you fill in by talking.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${shoulders.variable} ${schibsted.variable} ${martian.variable} ${kalam.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
