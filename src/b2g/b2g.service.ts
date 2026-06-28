import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class B2gService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getReports(filters: {
    city_or_district?: string;
    status?: string;
    waste_type?: string;
    danger_level?: string;
    limit?: number;
  }) {
    const supabase = this.supabaseService.getClient();

    // Query dasar menggunakan inner join ke profiles untuk memfilter wilayah kota/kabupaten
    let query = supabase
      .from('reports')
      .select(`
        id,
        reporter_id,
        image_url,
        description,
        location,
        status,
        confidence_score,
        waste_type,
        danger_level,
        created_at,
        updated_at,
        profiles!inner (
          id,
          username,
          full_name,
          province,
          city_or_district
        )
      `);

    // Terapkan filter-filter opsional
    if (filters.city_or_district) {
      query = query.eq('profiles.city_or_district', filters.city_or_district);
    }
    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    if (filters.waste_type) {
      query = query.eq('waste_type', filters.waste_type);
    }
    if (filters.danger_level) {
      query = query.eq('danger_level', filters.danger_level);
    }

    // Default limit 20, max limit 100 untuk keandalan throughput DaaS
    const limitCount = Math.min(filters.limit ?? 20, 100);
    query = query.limit(limitCount);

    // Urutkan berdasarkan waktu laporan terbaru
    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      throw new BadRequestException('Gagal mengambil data laporan spasial B2G: ' + error.message);
    }

    // Lakukan pemrosesan koordinat tambahan agar ramah diintegrasikan ke sistem GIS pemerintah (e.g. ArcGIS/QGIS)
    return (data || []).map((report: any) => {
      let latitude: number | null = null;
      let longitude: number | null = null;

      // Jika location disimpan sebagai GeoJSON Point oleh Supabase adapter
      if (report.location && typeof report.location === 'object') {
        const coords = report.location.coordinates;
        if (Array.isArray(coords) && coords.length >= 2) {
          longitude = coords[0];
          latitude = coords[1];
        }
      } 
      // Jika disimpan dalam bentuk WKT string "POINT(lng lat)"
      else if (typeof report.location === 'string' && report.location.includes('POINT')) {
        const matches = report.location.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/);
        if (matches && matches.length >= 3) {
          longitude = parseFloat(matches[1]);
          latitude = parseFloat(matches[2]);
        }
      }

      return {
        id: report.id,
        image_url: report.image_url,
        description: report.description,
        location: report.location,
        coordinates: {
          latitude,
          longitude,
        },
        status: report.status,
        confidence_score: report.confidence_score,
        waste_type: report.waste_type,
        danger_level: report.danger_level,
        created_at: report.created_at,
        updated_at: report.updated_at,
        region: {
          province: report.profiles?.province,
          city_or_district: report.profiles?.city_or_district,
        },
        reporter: {
          id: report.profiles?.id,
          username: report.profiles?.username,
          full_name: report.profiles?.full_name,
        },
      };
    });
  }

  async getSummary(city_or_district?: string) {
    const supabase = this.supabaseService.getClient();

    // Ambil laporan dasar dengan data profil untuk agregasi statistik
    let query = supabase
      .from('reports')
      .select(`
        id,
        status,
        waste_type,
        danger_level,
        profiles!inner (
          city_or_district
        )
      `);

    if (city_or_district) {
      query = query.eq('profiles.city_or_district', city_or_district);
    }

    const { data: reports, error } = await query;

    if (error) {
      throw new BadRequestException('Gagal menyusun ringkasan statistik B2G: ' + error.message);
    }

    const totalReports = reports?.length ?? 0;

    // Hitung status agregasi
    const statusCounts = { pending_ai: 0, approved: 0, resolved: 0, rejected: 0 };
    const dangerLevelCounts = { Rendah: 0, Sedang: 0, Tinggi: 0 };
    const wasteTypeCounts: Record<string, number> = {};
    const regionCounts: Record<string, number> = {};

    reports?.forEach((r: any) => {
      // Status
      if (r.status in statusCounts) {
        statusCounts[r.status as keyof typeof statusCounts]++;
      }

      // Tingkat bahaya
      if (r.danger_level in dangerLevelCounts) {
        dangerLevelCounts[r.danger_level as keyof typeof dangerLevelCounts]++;
      }

      // Tipe sampah
      if (r.waste_type) {
        wasteTypeCounts[r.waste_type] = (wasteTypeCounts[r.waste_type] ?? 0) + 1;
      }

      // Kota/Kabupaten
      const city = r.profiles?.city_or_district;
      if (city) {
        regionCounts[city] = (regionCounts[city] ?? 0) + 1;
      }
    });

    return {
      metadata: {
        timestamp: new Date().toISOString(),
        city_filtered: city_or_district ?? 'ALL_REGIONS',
        data_provider: 'Genesis.id DaaS Platform',
      },
      summary: {
        total_reports: totalReports,
        by_status: statusCounts,
        by_severity: dangerLevelCounts,
        by_waste_type: wasteTypeCounts,
        by_region: regionCounts,
      },
    };
  }
}
