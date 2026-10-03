import { useState, type ReactNode } from 'react';
import { Table2, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export interface TableData {
  columns: string[];
  rows: (string | number)[][];
}

/** Chart container with an accessible "view as table" alternative (WCAG, ROADMAP 1.3). */
export function ChartCard({
  title,
  description,
  table,
  children,
  className,
}: {
  title: string;
  description?: string;
  table: TableData;
  children: ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAsTable((v) => !v)}
          aria-pressed={asTable}
          aria-label={asTable ? `Show ${title} as chart` : `Show ${title} as table`}
        >
          {asTable ? <BarChart3 /> : <Table2 />}
        </Button>
      </CardHeader>
      <CardContent>
        {asTable ? (
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  {table.columns.map((c) => (
                    <th key={c} scope="col" className="py-1.5 pr-3 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {r.map((cell, j) => (
                      <td key={j} className="py-1.5 pr-3 tabular-nums">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div aria-hidden className="h-56">
            {children}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
