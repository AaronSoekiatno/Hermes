import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Upload, FileText, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export const UploadSection = () => {
  const [file, setFile] = useState<File | null>(null);
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.type === 'application/pdf' || selectedFile.name.endsWith('.pdf')) {
        setFile(selectedFile);
        toast({
          title: "Resume uploaded",
          description: `${selectedFile.name} is ready to send`,
        });
      } else {
        toast({
          title: "Invalid file type",
          description: "Please upload a PDF file",
          variant: "destructive",
        });
      }
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    toast({
      title: "Success!",
      description: "Your resume is being sent to top startups. We'll notify you when responses come in.",
    });
  };

  return (
    <section id="upload-section" className="py-20 bg-background">
      <div className="container px-4">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-4">
              Start Your Journey
            </h2>
            <p className="text-lg text-muted-foreground">
              Upload your resume and let AI do the rest
            </p>
          </div>

          <Card className="border-border shadow-xl">
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl">Upload Your Resume</CardTitle>
              <CardDescription>
                Fill in your details and upload your resume to get started
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name</Label>
                    <Input 
                      id="name" 
                      placeholder="John Doe" 
                      required
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input 
                      id="email" 
                      type="email" 
                      placeholder="john@example.com" 
                      required
                      className="bg-background"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="field">Field of Interest</Label>
                  <Input 
                    id="field" 
                    placeholder="e.g., Software Engineering, Marketing, Design" 
                    required
                    className="bg-background"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="message">Personal Message (Optional)</Label>
                  <Textarea 
                    id="message" 
                    placeholder="Tell us about yourself and what you're looking for..."
                    className="min-h-[100px] bg-background resize-none"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="resume">Resume (PDF)</Label>
                  <div className="relative">
                    <Input
                      id="resume"
                      type="file"
                      accept=".pdf"
                      onChange={handleFileChange}
                      className="hidden"
                      required
                    />
                    <label
                      htmlFor="resume"
                      className="flex items-center justify-center gap-2 w-full p-8 border-2 border-dashed border-border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors bg-background"
                    >
                      {file ? (
                        <>
                          <FileText className="h-6 w-6 text-primary" />
                          <span className="text-sm text-foreground">{file.name}</span>
                        </>
                      ) : (
                        <>
                          <Upload className="h-6 w-6 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">
                            Click to upload or drag and drop
                          </span>
                        </>
                      )}
                    </label>
                  </div>
                </div>

                <Button 
                  type="submit" 
                  size="lg" 
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  <Send className="mr-2 h-5 w-5" />
                  Send to Top Startups
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="mt-8 p-6 bg-muted/50 rounded-lg">
            <h3 className="font-semibold text-lg mb-3 text-foreground">What happens next?</h3>
            <ol className="space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <span className="font-semibold text-primary">1.</span>
                Our AI analyzes your resume and creates personalized messages
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-primary">2.</span>
                We match you with relevant startups in your field
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-primary">3.</span>
                Your resume is sent with tailored messages to each company
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-primary">4.</span>
                You receive notifications as responses come in
              </li>
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
};
