import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, ArrowLeft, House } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/motion/reveal";

export default function NotFound() {
  return (
    <div className="min-h-[100dvh] w-full bg-background px-4 py-10 sm:px-6">
      <Reveal className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-xl items-center justify-center">
        <Card className="w-full" data-testid="not-found-page">
          <CardContent className="p-8 text-center sm:p-12">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-secondary/15">
              <AlertCircle className="h-8 w-8 text-secondary" />
            </div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-secondary">404 · Page not found</p>
            <h1 className="heading-dashboard text-3xl">This page took a wrong turn.</h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              The link may be outdated, or the page may have moved. Let’s get you back to something useful.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/">
                <Button variant="outline"><House className="mr-2 h-4 w-4" />Go home</Button>
              </Link>
              <Button onClick={() => window.history.back()}><ArrowLeft className="mr-2 h-4 w-4" />Go back</Button>
            </div>
          </CardContent>
        </Card>
      </Reveal>
    </div>
  );
}
