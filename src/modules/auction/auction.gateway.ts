import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TokenService } from '../auth/services/token.service';
import { websocketCorsOptions } from '../../config/cors-origins.util';

@WebSocketGateway({ cors: websocketCorsOptions() })
export class AuctionGateway {
  @WebSocketServer()
  server: Server;

  constructor(private readonly tokenService: TokenService) {}

  emitBidPlaced(
    listingId: string,
    payload: { bidderId: string; amount: unknown },
  ) {
    this.server.to(listingId).emit('bidPlaced', payload);
  }

  emitAuctionFinished(listingId: string, payload: unknown) {
    this.server.to(listingId).emit('auctionFinished', payload);
  }

  @SubscribeMessage('joinAuction')
  handleJoin(
    @MessageBody() data: { listingId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const listingId = data?.listingId?.trim();
    if (!listingId) {
      return { error: 'listingId is required' };
    }

    const token =
      client.handshake.auth?.token?.split(' ')[1] ||
      client.handshake.headers.authorization?.split(' ')[1];
    if (!token) {
      return { error: 'Unauthorized' };
    }

    try {
      const payload = this.tokenService.verifyAccess(token);
      client.data.userId = payload.sub;
    } catch {
      return { error: 'Unauthorized' };
    }

    client.join(listingId);
    return { joined: listingId };
  }
}
