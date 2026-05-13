import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import * as xlsx from 'xlsx';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Read workbook
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Convert to JSON
    const data = xlsx.utils.sheet_to_json(worksheet) as any[];

    // Map to Lead type (try to flexibly match column names)
    const leads = data.map((row) => {
      // Find the best match for each field
      const name = row['Name'] || row['Business Name'] || row['Company'] || row['Title'] || 'Unknown Business';
      const website = row['Website'] || row['URL'] || row['Link'] || '';
      const phone = row['Phone'] || row['Phone Number'] || row['Contact'] || '';
      const rating = row['Rating'] || row['Stars'] || 0;
      const reviews = row['Reviews'] || row['Review Count'] || 0;
      
      // Try to determine industry from common fields
      const type = row['Type'] || row['Category'] || row['Industry'] || 'Unknown Industry';

      return {
        id: uuidv4(),
        name,
        website: website.startsWith('http') ? website : (website ? `https://${website}` : ''),
        phone: String(phone),
        rating: Number(rating) || 0,
        reviews: Number(reviews) || 0,
        category: type,
        status: 'new' as const,
        lastUpdated: new Date().toISOString()
      };
    });

    return NextResponse.json({ leads });
  } catch (error) {
    console.error('File upload error:', error);
    return NextResponse.json({ error: 'Failed to process file' }, { status: 500 });
  }
}