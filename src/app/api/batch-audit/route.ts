import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

// In-memory batch state
const batchJobs = new Map<string, {
    id: string;
    status: 'running' | 'idle' | 'completed' | 'failed';
    leads: Array<{ name: string; website: string; status: string; error?: string }>;
    current: number;
    total: number;
    startedAt: number;
    completedAt?: number;
}>();

export async function POST(req: NextRequest) {
    try {
        const { leads } = await req.json();
        if (!leads || !Array.isArray(leads) || leads.length === 0) {
            return NextResponse.json({ error: 'leads array is required' }, { status: 400 });
        }

        const batchId = uuidv4().substring(0, 8);
        const batch = {
            id: batchId,
            status: 'running' as const,
            leads: leads.map((l: any) => ({
                name: l.name || 'Unknown',
                website: l.website || '',
                status: 'queued' as string
            })),
            current: 0,
            total: leads.length,
            startedAt: Date.now()
        };

        batchJobs.set(batchId, batch);

        // Process asynchronously (don't await)
        processBatch(batchId, batch, leads).catch(err => {
            console.error(`[BATCH:${batchId}] Fatal error:`, err);
            const b = batchJobs.get(batchId);
            if (b) { b.status = 'failed'; }
        });

        return NextResponse.json({
            batchId,
            total: leads.length,
            message: `Batch audit started for ${leads.length} leads`
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    const batchId = req.nextUrl.searchParams.get('id');
    if (!batchId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    const batch = batchJobs.get(batchId);
    if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    return NextResponse.json({
        id: batch.id,
        status: batch.status,
        current: batch.current,
        total: batch.total,
        leads: batch.leads,
        progress: batch.total > 0 ? Math.round((batch.current / batch.total) * 100) : 0,
        startedAt: batch.startedAt,
        completedAt: batch.completedAt
    });
}

async function processBatch(batchId: string, batch: any, leads: any[]) {
    for (let i = 0; i < leads.length; i++) {
        const lead = leads[i];
        try {
            batch.leads[i].status = 'auditing';
            batch.current = i;

            const url = lead.website || `https://${lead.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;

             const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/api/audit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, mode: 'balanced' }),
                signal: AbortSignal.timeout(600000) // Increase to 10 mins for balanced
            });


            if (res.ok) {
                batch.leads[i].status = 'completed';
            } else {
                const err = await res.json().catch(() => ({}));
                batch.leads[i].status = 'failed';
                batch.leads[i].error = err.error || `HTTP ${res.status}`;
            }
        } catch (err: any) {
            batch.leads[i].status = 'failed';
            batch.leads[i].error = err.message;
        }
    }

    batch.status = 'completed';
    batch.current = batch.total;
    batch.completedAt = Date.now();
    console.log(`[BATCH:${batchId}] Complete: ${batch.total} leads processed`);
}