import { Hero } from "@/components/Hero";
import { Features } from "@/components/Features";
import { UploadSection } from "@/components/UploadSection";

const Index = () => {
  return (
    <main className="min-h-screen">
      <Hero />
      <Features />
      <UploadSection />
    </main>
  );
};

export default Index;
