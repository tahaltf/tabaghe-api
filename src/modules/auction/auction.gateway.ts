import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    MessageBody,
} from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ cors: true })
export class AuctionGateway {
    @WebSocketServer()
    server: Server;

    emitBidPlaced(listingId: string, payload: any) {
        this.server.to(listingId).emit('bidPlaced', payload);
    }

    emitAuctionFinished(listingId: string, payload: any) {
        this.server.to(listingId).emit('auctionFinished', payload);
    }

    @SubscribeMessage('joinAuction')
    handleJoin(@MessageBody() data: { listingId: string }) {
        return { joined: data.listingId };
    }
}
