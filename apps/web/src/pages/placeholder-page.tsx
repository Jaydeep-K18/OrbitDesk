import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Phase 0 routing shell page. Each route is replaced by its real page in Phase 1. */
export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <Card>
        <CardHeader>
          <CardTitle>Coming in Phase 1</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          This screen is part of the routing shell. Its wireframe lives in
          docs/design/wireframes.md.
        </CardContent>
      </Card>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <p className="text-sm font-medium text-primary">404</p>
      <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The page you’re looking for doesn’t exist.
      </p>
    </div>
  );
}
