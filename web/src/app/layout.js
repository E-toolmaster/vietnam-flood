import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: 'Cảnh Báo Ngập Lụt Khánh Hòa - Dữ liệu Realtime',
  description: 'Theo dõi mực nước sông Cái, xả lũ hồ chứa và mưa đầu nguồn tại Khánh Hòa. Cập nhật liên tục 15 phút/lần.',
  icons: {
    icon: '/favicon.ico', // Đường dẫn icon
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
