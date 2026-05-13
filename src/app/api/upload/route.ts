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

    console.log('Upload received. First row sample:', data[0]);

    // Map to Lead type (your Excel columns: title, category, street, city, state, postal_code, phone, website, review_count, review_rating, etc.)
    const leads = data.map((row, index) => {
      if (index === 0) {
        console.log('First row keys:', Object.keys(row));
      }

      const name = row['title'] || row['Title'] || row['name'] || row['Name'] || 'Unknown Business';
      const website = row['website'] || row['Website'] || row['url'] || row['URL'] || '';
      const phone = row['phone'] || row['Phone'] || row['Phone Number'] || '';
      const rating = row['review_rating'] || row['reviewRating'] || row['Review Rating'] || row['rating'] || row['Rating'] || row['stars'] || row['Stars'] || 0;
      const reviews = row['review_count'] || row['reviewCount'] || row['Review Count'] || row['reviews'] || row['Reviews'] || 0;
      const category = row['category'] || row['Category'] || row['Industry'] || 'Unknown Industry';
      
      // Build address from components
      const addressParts = [row['street'], row['city'], row['state'], row['postal_code']].filter(Boolean);
      const address = addressParts.length > 0 ? addressParts.join(', ') : undefined;

      return {
        id: uuidv4(),
        name: String(name),
        website: website.startsWith('http') ? website : (website ? `https://${website}` : ''),
        phone: String(phone),
        rating: Number(rating) || 0,
        reviews: Number(reviews) || 0,
        category: String(category),
        address,
        status: 'new' as const,
        lastUpdated: new Date().toISOString()
      };
    });

    console.log(`Mapped ${leads.length} leads`);
    return NextResponse.json({ leads });
  } catch (error) {
    console.error('File upload error:', error);
    return NextResponse.json({ error: 'Failed to process file: ' + (error as any).message }, { status: 500 });
  }
}
