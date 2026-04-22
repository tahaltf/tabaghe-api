import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Socket } from 'socket.io';

@WebSocketGateway({ cors: true })
export class AuctionGateway {
    @WebSocketServer()
    server: Server;

    emitBidPlaced(listingId: string, payload: { bidderId: string; amount: unknown }) {
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
        client.join(data.listingId);
        return { joined: data.listingId };
    }
}
