import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DevicesService } from '../devices/devices.service';

// firebase-admin is optional: only imported when FIREBASE_SERVICE_ACCOUNT is set.
// Install it separately: npm install firebase-admin
// eslint-disable-next-line @typescript-eslint/no-var-requires
let admin: any;

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private firebaseApp: any | null = null;

  constructor(private readonly devicesService: DevicesService) {}

  onModuleInit() {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountJson) {
      this.logger.warn(
        'FIREBASE_SERVICE_ACCOUNT env var not set — push notifications are disabled. ' +
          'Set it to a JSON-encoded Firebase service account to enable FCM.',
      );
      return;
    }

    try {
      admin = require('firebase-admin');
      const serviceAccount = JSON.parse(serviceAccountJson);
      // Only initialise once (guard against hot-reload in dev)
      if (!admin.apps.length) {
        this.firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      } else {
        this.firebaseApp = admin.app();
      }
      this.logger.log('Firebase Admin SDK initialised — push notifications enabled');
    } catch (err: any) {
      this.logger.error('Failed to initialise Firebase Admin SDK', err?.message);
    }
  }

  /** Send a push notification to a single device token. */
  async sendToToken(token: string, payload: PushPayload): Promise<boolean> {
    if (!this.firebaseApp) return false;
    try {
      await this.firebaseApp.messaging().send({
        token,
        notification: { title: payload.title, body: payload.body },
        data: payload.data ?? {},
        android: {
          priority: 'high',
          notification: { sound: 'default', channelId: 'photoapp_default' },
        },
        apns: {
          payload: { aps: { sound: 'default', badge: 1 } },
        },
      });
      return true;
    } catch (err: any) {
      // INVALID_REGISTRATION or NOT_REGISTERED → purge stale token
      if (
        err?.code === 'messaging/invalid-registration-token' ||
        err?.code === 'messaging/registration-token-not-registered'
      ) {
        await this.devicesService.removeStaleToken(token);
      } else {
        this.logger.error(`Push failed for token ${token.slice(0, 16)}…: ${err?.message}`);
      }
      return false;
    }
  }

  /** Send a push notification to all registered devices of a user. */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    const tokens = await this.devicesService.getTokensForUser(userId);
    if (!tokens.length) return;
    await Promise.allSettled(tokens.map((t) => this.sendToToken(t, payload)));
  }

  /** Notify a user that their backup completed. */
  async notifyBackupComplete(userId: string, uploadedCount: number) {
    await this.sendToUser(userId, {
      title: 'Backup complete',
      body:
        uploadedCount === 1
          ? '1 new photo backed up.'
          : `${uploadedCount} new photos backed up.`,
      data: { type: 'BACKUP_COMPLETE', count: String(uploadedCount) },
    });
  }

  /** Notify a user of new activity in a shared album. */
  async notifySharedAlbumActivity(userId: string, albumName: string, actorName: string) {
    await this.sendToUser(userId, {
      title: `New activity in "${albumName}"`,
      body: `${actorName} added photos to your shared album.`,
      data: { type: 'SHARED_ALBUM_ACTIVITY', albumName },
    });
  }
}
