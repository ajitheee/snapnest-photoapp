import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface TripCluster {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  location: string;
  assetCount: number;
  coverAssetId: string | null;
}

@Injectable()
export class TripsService {
  constructor(private readonly prisma: PrismaService) {}

  async getTrips(ownerId: string): Promise<TripCluster[]> {
    const assets = await this.prisma.asset.findMany({
      where: {
        ownerId,
        isDeleted: false,
        isArchived: false,
        locationLat: { not: null },
        locationLng: { not: null },
        locationCity: { not: null },
      },
      select: {
        id: true,
        fileCreatedAt: true,
        locationLat: true,
        locationLng: true,
        locationCity: true,
        locationState: true,
        locationCountry: true,
        thumbnailSmallPath: true,
      },
      orderBy: { fileCreatedAt: 'asc' },
    });

    if (assets.length === 0) return [];

    const cityCount = new Map<string, number>();
    for (const a of assets) {
      const key = a.locationCity || '';
      cityCount.set(key, (cityCount.get(key) || 0) + 1);
    }
    let homeCity = '';
    let maxCount = 0;
    for (const [city, count] of cityCount) {
      if (count > maxCount) { maxCount = count; homeCity = city; }
    }

    const awayAssets = assets.filter(a => a.locationCity !== homeCity);
    if (awayAssets.length === 0) return [];

    const trips: { assets: typeof awayAssets; location: string }[] = [];
    let currentTrip: typeof awayAssets = [];
    let lastDate: Date | null = null;

    for (const asset of awayAssets) {
      const date = new Date(asset.fileCreatedAt);
      if (lastDate && (date.getTime() - lastDate.getTime()) > 2 * 24 * 60 * 60 * 1000) {
        if (currentTrip.length >= 3) {
          const loc = this.getMostCommonLocation(currentTrip);
          trips.push({ assets: [...currentTrip], location: loc });
        }
        currentTrip = [];
      }
      currentTrip.push(asset);
      lastDate = date;
    }
    if (currentTrip.length >= 3) {
      trips.push({ assets: [...currentTrip], location: this.getMostCommonLocation(currentTrip) });
    }

    return trips.map((trip, i) => ({
      id: `trip-${i}`,
      name: trip.location,
      startDate: trip.assets[0].fileCreatedAt.toISOString(),
      endDate: trip.assets[trip.assets.length - 1].fileCreatedAt.toISOString(),
      location: trip.location,
      assetCount: trip.assets.length,
      coverAssetId: trip.assets[0].id,
    })).reverse();
  }

  async getTripAssets(ownerId: string, startDate: string, endDate: string, location: string) {
    const parts = location.split(',').map(p => p.trim());
    const city = parts[0] || '';

    return this.prisma.asset.findMany({
      where: {
        ownerId,
        isDeleted: false,
        isArchived: false,
        locationCity: { contains: city, mode: 'insensitive' },
        fileCreatedAt: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      orderBy: { fileCreatedAt: 'asc' },
    });
  }

  private getMostCommonLocation(assets: any[]): string {
    const counts = new Map<string, number>();
    for (const a of assets) {
      const loc = [a.locationCity, a.locationCountry].filter(Boolean).join(', ');
      counts.set(loc, (counts.get(loc) || 0) + 1);
    }
    let best = '';
    let max = 0;
    for (const [loc, count] of counts) {
      if (count > max) { max = count; best = loc; }
    }
    return best;
  }
}
